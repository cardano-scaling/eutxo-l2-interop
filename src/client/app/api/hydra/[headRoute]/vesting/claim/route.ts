// Import slot config FIRST to ensure it's set before any other imports
import '@/lib/slot-config'

import { NextRequest, NextResponse } from 'next/server'
import { HydraHandler } from '@/lib/hydra/handler'
import { HydraProvider } from '@/lib/hydra/provider'
import { Lucid, Data, credentialToAddress } from '@lucid-evolution/lucid'
import { getScriptInfo } from '@/lib/hydra-utils'
import { VestingDatum, VestingDatumT } from '@/lib/types'
import { loadUserPrivateKey, loadUserPublicKey } from '@/lib/user-credentials'
import { UserName } from '@/lib/users'
import { getHeadConfigFromCookie } from '@/lib/api-topology'

/**
 * POST /api/hydra/[headRoute]/vesting/claim
 * Claim funds from a Vesting contract
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ headRoute: string }> }
) {
  try {
    const { headRoute } = await params
    const body = await request.json()
    const { utxoId, claimerName } = body

    // Validate input
    if (!utxoId || !claimerName) {
      return NextResponse.json(
        { error: 'Missing required fields: utxoId, claimerName' },
        { status: 400 }
      )
    }

    // Get topology and head config from cookie
    const result = await getHeadConfigFromCookie(headRoute)
    
    if (!result) {
      return NextResponse.json(
        { error: 'Topology not selected or head not found' },
        { status: 400 }
      )
    }

    const { headConfig } = result

    // Validate user name
    const claimer = claimerName as UserName
    if (!['alice', 'bob', 'ida'].includes(claimer)) {
      return NextResponse.json(
        { error: 'Invalid user name' },
        { status: 400 }
      )
    }

    // Connect to the head's Hydra node using hardcoded httpUrl from config
    const handler = new HydraHandler(headConfig.httpUrl)
    const provider = new HydraProvider(handler)
    const lucid = await Lucid(provider, 'Custom')

    // Load claimer credentials
    const claimerSk = loadUserPrivateKey(claimer)
    const claimerVk = loadUserPublicKey(claimer)
    lucid.selectWallet.fromPrivateKey(claimerSk.to_bech32())

    const claimerAddress = credentialToAddress('Custom', { type: 'Key', hash: claimerVk.hash().to_hex() })

    // Get vesting script
    const [vestingScriptBytes, vestingScriptHash] = getScriptInfo('vesting')

    // Get vesting UTXOs
    const vestingUtxos = await lucid.utxosAt({ type: 'Script', hash: vestingScriptHash })

    // Parse UTXO ID (format: txHash#outputIndex)
    const [txHash, outputIndexStr] = utxoId.split('#')
    const outputIndex = parseInt(outputIndexStr, 10)

    // Find the specific UTXO
    const vestingUtxo = vestingUtxos.find(
      (utxo) => utxo.txHash === txHash && utxo.outputIndex === outputIndex
    )

    if (!vestingUtxo) {
      return NextResponse.json(
        { error: 'UTXO not found' },
        { status: 404 }
      )
    }

    if (!vestingUtxo.datum) {
      return NextResponse.json(
        { error: 'UTXO has no datum' },
        { status: 400 }
      )
    }

    // Parse vesting datum
    const vestingDatum = Data.from<VestingDatumT>(vestingUtxo.datum, VestingDatum)

    // Verify the claimer is the receiver
    if (vestingDatum.receiver !== claimerVk.hash().to_hex()) {
      return NextResponse.json(
        { error: 'You are not the receiver of this vesting contract' },
        { status: 403 }
      )
    }

    const { timeout } = vestingDatum

    // Build and sign transaction
    let tx, txSigned, submittedTx
    try {
      // Build transaction - match offchain structure exactly
      // validFrom is timeout + 1 minute to ensure it's after the timeout
      tx = await lucid
        .newTx()
        .collectFrom([vestingUtxo], Data.void())
        .validFrom(Number(timeout) + 1 * 60 * 1000)
        .addSigner(claimerAddress)
        .attach.Script({ type: 'PlutusV3', script: vestingScriptBytes })
        .complete()
    } catch (txError) {
      return NextResponse.json(
        {
          error: 'Failed to build transaction',
          details: txError instanceof Error ? txError.message : String(txError),
        },
        { status: 500 }
      )
    }

    try {
      txSigned = await tx.sign.withWallet().complete()
    } catch (signError) {
      return NextResponse.json(
        {
          error: 'Failed to sign transaction',
          details: signError instanceof Error ? signError.message : String(signError),
        },
        { status: 500 }
      )
    }

    try {
      // Submit transaction
      submittedTx = await txSigned.submit()

      // Wait for transaction confirmation
      await lucid.awaitTx(submittedTx, 3000)
    } catch (submitError) {
      return NextResponse.json(
        {
          error: 'Failed to submit transaction',
          details: submitError instanceof Error ? submitError.message : String(submitError),
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      txHash: submittedTx,
      message: 'Vesting claim transaction submitted successfully',
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to claim vesting',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

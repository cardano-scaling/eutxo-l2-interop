// Import slot config FIRST to ensure it's set before any other imports
import '@/lib/slot-config'

import { NextRequest, NextResponse } from 'next/server'
import { HydraHandler } from '@/lib/hydra/handler'
import { HydraProvider } from '@/lib/hydra/provider'
import { Lucid, Data, credentialToAddress } from '@lucid-evolution/lucid'
import { getScriptInfo } from '@/lib/hydra-utils'
import { HtlcDatum, HtlcDatumT, Spend } from '@/lib/types'
import { loadUserPrivateKey, loadUserPublicKey } from '@/lib/user-credentials'
import { UserName } from '@/lib/users'
import { getHeadConfigFromCookie, getHeadNodeUrl } from '@/lib/api-topology'

/**
 * POST /api/hydra/[headRoute]/htlc/refund
 * Refund funds from an HTLC contract after timeout
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ headRoute: string }> }
) {
  try {
    const { headRoute } = await params
    const body = await request.json()
    const { utxoId, senderName } = body

    // Validate input
    if (!utxoId || !senderName) {
      return NextResponse.json(
        { error: 'Missing required fields: utxoId, senderName' },
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
    const sender = senderName as UserName
    if (!['alice', 'bob', 'ida'].includes(sender)) {
      return NextResponse.json(
        { error: 'Invalid user name' },
        { status: 400 }
      )
    }

    // Connect to the head's Hydra node using first available node URL from config
    const nodeUrl = getHeadNodeUrl(headConfig)
    const handler = new HydraHandler(nodeUrl)
    const provider = new HydraProvider(handler)
    
    const lucid = await Lucid(provider, 'Custom')

    // Load sender credentials
    const senderSk = loadUserPrivateKey(sender)
    const senderVk = loadUserPublicKey(sender)
    lucid.selectWallet.fromPrivateKey(senderSk.to_bech32())

    const senderAddress = credentialToAddress('Custom', { type: 'Key', hash: senderVk.hash().to_hex() })

    // Get HTLC script
    const [htlcScriptBytes, htlcScriptHash] = getScriptInfo('htlc')

    // Get HTLC UTXOs
    const htlcUtxos = await lucid.utxosAt({ type: 'Script', hash: htlcScriptHash })

    // Parse UTXO ID (format: txHash#outputIndex)
    const [txHash, outputIndexStr] = utxoId.split('#')
    const outputIndex = parseInt(outputIndexStr, 10)

    // Find the specific UTXO
    const htlcUtxo = htlcUtxos.find(
      (utxo) => utxo.txHash === txHash && utxo.outputIndex === outputIndex
    )

    if (!htlcUtxo) {
      return NextResponse.json(
        { error: 'UTXO not found' },
        { status: 404 }
      )
    }

    if (!htlcUtxo.datum) {
      return NextResponse.json(
        { error: 'UTXO has no datum' },
        { status: 400 }
      )
    }

    // Parse HTLC datum
    const htlcDatum = Data.from<HtlcDatumT>(htlcUtxo.datum, HtlcDatum)

    // Verify the sender is the original sender
    if (htlcDatum.sender !== senderVk.hash().to_hex()) {
      return NextResponse.json(
        { error: 'You are not the sender of this HTLC' },
        { status: 403 }
      )
    }

    // Build and sign transaction - mirroring offchain refund.ts
    let tx, txSigned, submittedTx
    try {
      tx = await lucid
        .newTx()
        .validFrom(Date.now())
        .addSignerKey(senderVk.hash().to_hex())
        .collectFrom([htlcUtxo], Spend.Refund)
        .attach.SpendingValidator({ type: 'PlutusV3', script: htlcScriptBytes })
        .complete()

      txSigned = await tx.sign.withWallet().complete()
    } catch (txError) {
      console.error('Error building/signing transaction:', txError)
      return NextResponse.json(
        {
          error: 'Failed to build or sign transaction',
          details: txError instanceof Error ? txError.message : String(txError),
        },
        { status: 500 }
      )
    }

    try {
      // Submit transaction
      submittedTx = await txSigned.submit()
      console.log('HTLC refund transaction submitted:', submittedTx)

      // Wait for transaction confirmation
      await lucid.awaitTx(submittedTx, 3000)
    } catch (submitError) {
      console.error('Error submitting transaction:', submitError)
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
      message: 'HTLC refund transaction submitted successfully',
    })
  } catch (error) {
    console.error('Error refunding HTLC:', error)
    return NextResponse.json(
      {
        error: 'Failed to refund HTLC',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

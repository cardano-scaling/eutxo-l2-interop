// Import slot config FIRST to ensure it's set before any other imports
import '@/lib/slot-config'

import { NextRequest, NextResponse } from 'next/server'
import { HydraHandler } from '@/lib/hydra/handler'
import { HydraProvider } from '@/lib/hydra/provider'
import { Lucid, Data, credentialToAddress } from '@lucid-evolution/lucid'
import { hydraHeads } from '@/lib/config'
import { getScriptInfo, dataAddressToBech32, dataPairsToAssets } from '@/lib/hydra-utils'
import { HtlcDatum, HtlcDatumT, HtlcRedeemer, HtlcRedeemerT } from '@/lib/types'
import { loadUserPrivateKey, loadUserPublicKey } from '@/lib/user-credentials'
import { UserName} from '@/lib/users'

/**
 * POST /api/hydra/[headRoute]/htlc/claim
 * Claim funds from an HTLC contract using a preimage
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ headRoute: string }> }
) {
  try {    
    const { headRoute } = await params
    const body = await request.json()
    const { utxoId, preimage, claimerName } = body

    // Validate input
    if (!utxoId || !preimage || !claimerName) {
      return NextResponse.json(
        { error: 'Missing required fields: utxoId, preimage, claimerName' },
        { status: 400 }
      )
    }

    const headConfig = hydraHeads.find((head) => head.route === headRoute)
    if (!headConfig) {
      return NextResponse.json(
        { error: 'Head not found' },
        { status: 404 }
      )
    }

    // Validate user name
    const claimer = claimerName as UserName
    if (!['alice', 'bob', 'ida'].includes(claimer)) {
      return NextResponse.json(
        { error: 'Invalid user name' },
        { status: 400 }
      )
    }

    // Connect to the head's Hydra node (not the claimer's node)
    // All users connect to the same head node when operating on that head
    const handler = new HydraHandler(headConfig.httpUrl)
    const provider = new HydraProvider(handler)
    
    const lucid = await Lucid(provider, 'Custom')

    // Load claimer credentials
    const claimerSk = loadUserPrivateKey(claimer)
    const claimerVk = loadUserPublicKey(claimer)
    lucid.selectWallet.fromPrivateKey(claimerSk.to_bech32())

    const claimerAddress = credentialToAddress('Custom', { type: 'Key', hash: claimerVk.hash().to_hex() })

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

    // Verify the claimer is the receiver
    if (htlcDatum.receiver !== claimerVk.hash().to_hex()) {
      return NextResponse.json(
        { error: 'You are not the receiver of this HTLC' },
        { status: 403 }
      )
    }

    const { timeout, desired_output } = htlcDatum

    // Use preimage directly as string (matching offchain behavior)
    // Data.Bytes() in Data.to accepts hex strings directly
    // Remove '0x' prefix if present
    const preimageHex = preimage.startsWith('0x') ? preimage.slice(2) : preimage
    if (!/^[0-9a-fA-F]+$/.test(preimageHex)) {
      return NextResponse.json(
        { error: 'Invalid preimage format. Must be a valid hex string.' },
        { status: 400 }
      )
    }

    // Convert timeout BigInt to number safely
    // 5 minutes before timeout to account for block and slot rounding
    const timeoutNumber = Number(timeout)
    const validToTime = timeoutNumber - 5 * 60 * 1000
    
    // Validate validTo is a valid number
    if (!Number.isFinite(validToTime) || validToTime <= 0) {
      return NextResponse.json(
        { 
          error: 'Invalid timeout value. Transaction would be invalid.',
          details: {
            timeout: timeout.toString(),
            timeoutNumber,
            validToTime,
            isFinite: Number.isFinite(validToTime),
            isPositive: validToTime > 0
          }
        },
        { status: 400 }
      )
    }

    // Build and sign transaction
    let tx, txSigned, submittedTx
    try {
      // Build transaction - match offchain structure exactly
      // Pass preimage as hex string (Data.Bytes() accepts hex strings)
      tx = await lucid
        .newTx()
        .collectFrom([htlcUtxo], Data.to<HtlcRedeemerT>({ Claim: [preimageHex] }, HtlcRedeemer))
        // 20 minutes before timeout to account for block and slot rounding
        .validTo(validToTime)
        .addSigner(claimerAddress)
        .attach.Script({ type: 'PlutusV3', script: htlcScriptBytes })

      // Pay to desired output address
      const outputAddress = dataAddressToBech32(lucid, desired_output.address)
      const outputAssets = dataPairsToAssets(desired_output.value)
      
      if (desired_output.datum == null) {
        tx.pay.ToAddress(outputAddress, outputAssets)
      } else {
        const datumValue = Data.to(desired_output.datum)
        tx.pay.ToAddressWithData(
          outputAddress,
          {
            kind: 'inline',
            value: datumValue,
          },
          outputAssets
        )
      }
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
      const completedTx = await tx.complete()
      txSigned = await completedTx.sign.withWallet().complete()
    } catch (signError) {
      console.log(signError)
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
      message: 'HTLC claim transaction submitted successfully',
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to claim HTLC',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

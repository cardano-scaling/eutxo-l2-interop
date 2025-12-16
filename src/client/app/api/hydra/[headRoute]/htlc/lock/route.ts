// Import slot config FIRST to ensure it's set before any other imports
import '@/lib/slot-config'

import { NextRequest, NextResponse } from 'next/server'
import { HydraHandler } from '@/lib/hydra/handler'
import { HydraProvider } from '@/lib/hydra/provider'
import { Lucid, Assets, Data, credentialToAddress, SpendingValidator, validatorToAddress } from '@lucid-evolution/lucid'
import { hydraHeads } from '@/lib/config'
import { getScriptInfo, assetsToDataPairs, bech32ToDataAddress, getNetworkFromLucid } from '@/lib/hydra-utils'
import { HtlcDatum, HtlcDatumT, HtlcOutputT, VestingDatum, VestingDatumT } from '@/lib/types'
import { loadUserPrivateKey, loadUserPublicKey } from '@/lib/user-credentials'
import { getUser, UserName } from '@/lib/users'

/**
 * POST /api/hydra/[headRoute]/htlc/lock
 * Create and submit an HTLC lock transaction
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ headRoute: string }> }
) {
  try {
    const { headRoute } = await params
    
    // Check content type
    const contentType = request.headers.get('content-type')
    if (!contentType || !contentType.includes('application/json')) {
      return NextResponse.json(
        { error: 'Content-Type must be application/json' },
        { status: 400 }
      )
    }

    // Parse request body
    const body = await request.json()
    
    const { senderName, recipientName, amountAda, htlcHash, timeoutMinutes, desiredOutput: desiredOutputConfig } = body

    // Validate input
    if (!senderName || !recipientName || !amountAda || !htlcHash || !timeoutMinutes) {
      return NextResponse.json(
        { error: 'Missing required fields: senderName, recipientName, amountAda, htlcHash, timeoutMinutes' },
        { status: 400 }
      )
    }

    // Validate desiredOutput
    if (!desiredOutputConfig || !desiredOutputConfig.type || !desiredOutputConfig.receiver) {
      return NextResponse.json(
        { error: 'Missing required fields: desiredOutput.type, desiredOutput.receiver' },
        { status: 400 }
      )
    }
    
    if (desiredOutputConfig.type === 'vesting' && !desiredOutputConfig.datumTimeoutMinutes) {
      return NextResponse.json(
        { error: 'Missing required field: desiredOutput.datumTimeoutMinutes (required for vesting type)' },
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

    // Validate user names
    const sender = senderName as UserName
    const recipient = recipientName as UserName
    if (!['alice', 'bob', 'ida'].includes(sender) || !['alice', 'bob', 'ida'].includes(recipient)) {
      return NextResponse.json(
        { error: 'Invalid user name' },
        { status: 400 }
      )
    }

    // Connect to the head's Hydra node (not the sender's node)
    // All users connect to the same head node when operating on that head
    const handler = new HydraHandler(headConfig.httpUrl)
    const provider = new HydraProvider(handler)
    const lucid = await Lucid(provider, 'Custom')
    const network = getNetworkFromLucid(lucid)

    // Load sender credentials
    const senderSk = loadUserPrivateKey(sender)
    const senderVk = loadUserPublicKey(sender)
    lucid.selectWallet.fromPrivateKey(senderSk.to_bech32())

    // Load recipient credentials to get their vkHash
    const recipientVk = loadUserPublicKey(recipient)

    // Parse inputs
    const amount = BigInt(Math.floor(parseFloat(amountAda) * 1_000_000)) // Convert ADA to lovelace
    const htlcTimeout = BigInt(Date.now() + parseInt(timeoutMinutes) * 60 * 1000)

    const payAmount: Assets = { ['lovelace']: amount }

    // Validate desired output receiver
    const desiredOutputReceiver = desiredOutputConfig.receiver as UserName
    if (!['alice', 'bob', 'ida'].includes(desiredOutputReceiver)) {
      return NextResponse.json(
        { error: 'Invalid desired output receiver name' },
        { status: 400 }
      )
    }

    // Build desired output based on type
    let desiredOutputBuilt: HtlcOutputT

    if (desiredOutputConfig.type === 'user') {
      // Send to user address directly (no datum)
      const desiredReceiverVk = loadUserPublicKey(desiredOutputReceiver)
      const desiredAddress = credentialToAddress(network, {
        type: 'Key',
        hash: desiredReceiverVk.hash().to_hex(),
      })

      desiredOutputBuilt = {
        address: bech32ToDataAddress(desiredAddress),
        value: assetsToDataPairs(payAmount),
        datum: null,
      }
    } else if (desiredOutputConfig.type === 'vesting') {
      // Send to vesting contract (with datum)
      const desiredReceiverVk = loadUserPublicKey(desiredOutputReceiver)
      const vestingTimeout = BigInt(Date.now() + parseInt(desiredOutputConfig.datumTimeoutMinutes) * 60 * 1000)

      // Build vesting datum
      const desiredDatum: VestingDatumT = {
        receiver: desiredReceiverVk.hash().to_hex(),
        timeout: vestingTimeout,
      }

      // Get vesting script address
      const [, vestingScriptHash] = getScriptInfo('vesting')
      const vestingAddress = credentialToAddress(network, {
        type: 'Script',
        hash: vestingScriptHash,
      })

      desiredOutputBuilt = {
        address: bech32ToDataAddress(vestingAddress),
        value: assetsToDataPairs(payAmount),
        datum: Data.from(Data.to<VestingDatumT>(desiredDatum, VestingDatum)),
      }
    } else {
      return NextResponse.json(
        { error: 'Invalid desired output type' },
        { status: 400 }
      )
    }

    // Build HTLC datum
    // Convert hash hex string to bytes format expected by Data.Bytes
    // Data.Bytes expects hex string, so we ensure it's valid hex
    const hashHex = htlcHash.startsWith('0x') ? htlcHash.slice(2) : htlcHash
    if (!/^[0-9a-fA-F]+$/.test(hashHex)) {
      return NextResponse.json(
        { error: 'Invalid hash format. Must be a valid hex string.' },
        { status: 400 }
      )
    }

    const htlcDatum: HtlcDatumT = {
      hash: hashHex,
      timeout: htlcTimeout,
      sender: senderVk.hash().to_hex(),
      receiver: recipientVk.hash().to_hex(),
      desired_output: desiredOutputBuilt,
    }

    let datum
    try {
      datum = Data.to<HtlcDatumT>(htlcDatum, HtlcDatum)
    } catch (datumError) {
      console.error('Error creating HTLC datum:', datumError)
      return NextResponse.json(
        { 
          error: 'Failed to create HTLC datum',
          details: datumError instanceof Error ? datumError.message : String(datumError)
        },
        { status: 500 }
      )
    }

    // Get HTLC script
    const [htlcScriptBytes] = getScriptInfo('htlc')
    const script: SpendingValidator = {
      type: 'PlutusV3',
      script: htlcScriptBytes,
    }

    const scriptAddress = validatorToAddress(network, script)

    // Build and sign transaction
    let tx, txSigned, submittedTx
    try {
      tx = await lucid
        .newTx()
        .pay.ToContract(scriptAddress, { kind: 'inline', value: datum }, payAmount)
        .complete()
    } catch (txError) {
      console.error('Error building transaction:', txError)
      return NextResponse.json(
        { 
          error: 'Failed to build transaction',
          details: txError instanceof Error ? txError.message : String(txError)
        },
        { status: 500 }
      )
    }

    try {
      txSigned = await tx.sign.withWallet().complete()
    } catch (signError) {
      console.error('Error signing transaction:', signError)
      return NextResponse.json(
        { 
          error: 'Failed to sign transaction',
          details: signError instanceof Error ? signError.message : String(signError)
        },
        { status: 500 }
      )
    }

    try {
      // Submit transaction
      submittedTx = await txSigned.submit()
      console.log('HTLC lock transaction submitted:', submittedTx)

      // Wait for transaction confirmation
      await lucid.awaitTx(submittedTx, 3000)
    } catch (submitError) {
      console.error('Error submitting transaction:', submitError)
      return NextResponse.json(
        { 
          error: 'Failed to submit transaction',
          details: submitError instanceof Error ? submitError.message : String(submitError)
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      txHash: submittedTx,
      message: 'HTLC lock transaction submitted successfully',
    }, { status: 200 })
  } catch (error) {
    console.error('Error locking HTLC:', error)
    return NextResponse.json(
      {
        error: 'Failed to lock HTLC',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}


import { NextRequest, NextResponse } from 'next/server'
import { HydraHandler } from '@/lib/hydra/handler'
import { HydraProvider } from '@/lib/hydra/provider'
import { Lucid, Data } from '@lucid-evolution/lucid'
import { hydraHeads, htlcContract, vestingContractAddress } from '@/lib/config'
import { getScriptInfo } from '@/lib/hydra-utils'
import { HtlcDatum, HtlcDatumT, VestingDatum, VestingDatumT } from '@/lib/types'
import type { UTxO } from '@lucid-evolution/lucid'

/**
 * HtlcUtxoItem type matching the client component
 */
type HtlcUtxoItem = {
  id: string
  hash: string
  timeout: number
  from: string
  to: string
  amountAda: number
  address: string
}

/**
 * Convert Lucid UTxO to HtlcUtxoItem format (server-side)
 */
function utxoToHtlcItem(utxo: UTxO, isVesting: boolean): HtlcUtxoItem | null {
  try {
    if (!utxo.datum) return null

    // UTxO assets are already in Assets format
    const amountAda = Number(utxo.assets.lovelace || 0n) / 1_000_000

    if (isVesting) {
      const datum = Data.from<VestingDatumT>(utxo.datum, VestingDatum)

      return {
        id: `${utxo.txHash}#${utxo.outputIndex}`,
        hash: '', // Vesting doesn't have hash
        timeout: Number(datum.timeout),
        from: '', // Not in vesting datum
        to: datum.receiver, // vkHash hex
        amountAda,
        address: vestingContractAddress,
      }
    } else {
      const datum = Data.from<HtlcDatumT>(utxo.datum, HtlcDatum)

      return {
        id: `${utxo.txHash}#${utxo.outputIndex}`,
        hash: datum.hash,
        timeout: Number(datum.timeout),
        from: datum.sender, // vkHash hex
        to: datum.receiver, // vkHash hex
        amountAda,
        address: htlcContract.address,
      }
    }
  } catch (error) {
    console.error('Error converting UTXO:', error, utxo)
    return null
  }
}

/**
 * GET /api/hydra/[headRoute]/utxos
 * Fetch UTXOs from a Hydra head and convert to client format
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ headRoute: string }> }
) {
  try {
    const { headRoute } = await params
    const headConfig = hydraHeads.find((head) => head.route === headRoute)

    if (!headConfig) {
      return NextResponse.json(
        { error: 'Head not found' },
        { status: 404 }
      )
    }

    // Connect to Hydra node
    const handler = new HydraHandler(headConfig.httpUrl)
    const provider = new HydraProvider(handler)
    const lucid = await Lucid(provider, 'Custom')

    // Get HTLC and Vesting script hashes
    const [, htlcScriptHash] = getScriptInfo('htlc')
    const [, vestingScriptHash] = getScriptInfo('vesting')

    // Fetch UTXOs at contract addresses
    const htlcUtxos = await lucid.utxosAt({ type: 'Script', hash: htlcScriptHash })
    const vestingUtxos = await lucid.utxosAt({ type: 'Script', hash: vestingScriptHash })

    // Convert to client format
    const htlcItems = htlcUtxos
      .map((utxo) => utxoToHtlcItem(utxo, false))
      .filter((item): item is HtlcUtxoItem => item !== null)

    const vestingItems = vestingUtxos
      .map((utxo) => utxoToHtlcItem(utxo, true))
      .filter((item): item is HtlcUtxoItem => item !== null)

    // Return clean JSON array
    return NextResponse.json({
      utxos: [...htlcItems, ...vestingItems],
    })
  } catch (error) {
    console.error('Error fetching UTXOs:', error)
    return NextResponse.json(
      { error: 'Failed to fetch UTXOs', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

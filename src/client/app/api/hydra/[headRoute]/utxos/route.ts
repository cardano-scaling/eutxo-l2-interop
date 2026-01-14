import { NextRequest, NextResponse } from 'next/server'
import { HydraHandler } from '@/lib/hydra/handler'
import { HydraProvider } from '@/lib/hydra/provider'
import { Lucid, Data, validatorToAddress } from '@lucid-evolution/lucid'
import { getHeadConfigFromCookie, getHeadNodeUrl } from '@/lib/api-topology'
import { getScriptInfo } from '@/lib/hydra-utils'
import { HtlcDatum, HtlcDatumT, VestingDatum, VestingDatumT } from '@/lib/types'
import { getAllUsers } from '@/lib/users'
import type { UTxO } from '@lucid-evolution/lucid'

/**
 * UtxoItem type matching the client component
 */
type UtxoItem = {
  id: string
  amountAda: number
  address: string
  type: 'htlc' | 'vesting' | 'user'
  hash?: string
  timeout?: number
  from?: string
  to?: string
  owner?: string
  ownerVkHash?: string
}

/**
 * Convert Lucid UTxO to UtxoItem format for contracts (server-side)
 */
function utxoToContractItem(utxo: UTxO, isVesting: boolean, contractAddress: string): UtxoItem | null {
  try {
    if (!utxo.datum) return null

    // UTxO assets are already in Assets format
    const amountAda = Number(utxo.assets.lovelace || 0n) / 1_000_000

    if (isVesting) {
      const datum = Data.from<VestingDatumT>(utxo.datum, VestingDatum)

      return {
        id: `${utxo.txHash}#${utxo.outputIndex}`,
        type: 'vesting',
        timeout: Number(datum.timeout),
        to: datum.receiver, // vkHash hex
        amountAda,
        address: contractAddress,
      }
    } else {
      const datum = Data.from<HtlcDatumT>(utxo.datum, HtlcDatum)

      return {
        id: `${utxo.txHash}#${utxo.outputIndex}`,
        type: 'htlc',
        hash: datum.hash,
        timeout: Number(datum.timeout),
        from: datum.sender, // vkHash hex
        to: datum.receiver, // vkHash hex
        amountAda,
        address: contractAddress,
      }
    }
  } catch (error) {
    console.error('Error converting contract UTXO:', error, utxo)
    return null
  }
}

/**
 * Convert Lucid UTxO to UtxoItem format for user UTXOs (server-side)
 */
function utxoToUserItem(utxo: UTxO, ownerName: string, ownerVkHash: string, userAddress: string): UtxoItem {
  const amountAda = Number(utxo.assets.lovelace || 0n) / 1_000_000

  return {
    id: `${utxo.txHash}#${utxo.outputIndex}`,
    type: 'user',
    amountAda,
    address: userAddress,
    owner: ownerName,
    ownerVkHash,
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
    
    // Get topology and head config from cookie
    const result = await getHeadConfigFromCookie(headRoute)
    
    if (!result) {
      return NextResponse.json(
        { error: 'Topology not selected or head not found' },
        { status: 400 }
      )
    }

    const { headConfig } = result

    // Connect to Hydra node using first available node URL from config
    const nodeUrl = getHeadNodeUrl(headConfig)
    const handler = new HydraHandler(nodeUrl)
    const provider = new HydraProvider(handler)
    const lucid = await Lucid(provider, 'Custom')

    // Get HTLC and Vesting script info
    const [htlcScript] = getScriptInfo('htlc')
    const [vestingScript] = getScriptInfo('vesting')
    
    // Get contract addresses from scripts
    const htlcAddress = validatorToAddress('Custom', { type: 'PlutusV3', script: htlcScript })
    const vestingAddress = validatorToAddress('Custom', { type: 'PlutusV3', script: vestingScript })

    // Fetch UTXOs at contract addresses
    const htlcUtxos = await lucid.utxosAt(htlcAddress)
    const vestingUtxos = await lucid.utxosAt(vestingAddress)

    // Convert contract UTXOs to client format
    const htlcItems = htlcUtxos
      .map((utxo) => utxoToContractItem(utxo, false, htlcAddress))
      .filter((item): item is UtxoItem => item !== null)

    const vestingItems = vestingUtxos
      .map((utxo) => utxoToContractItem(utxo, true, vestingAddress))
      .filter((item): item is UtxoItem => item !== null)

    // Fetch UTXOs at user addresses
    const allUsers = getAllUsers()
    const userUtxosArrays = await Promise.all(
      allUsers.map(async (user) => {
        const utxos = await lucid.utxosAt(user.address)
        return utxos.map((utxo) => utxoToUserItem(utxo, user.name, user.vkHash, user.address))
      })
    )
    const userItems = userUtxosArrays.flat()

    // Return clean JSON array with all UTXO types
    return NextResponse.json({
      utxos: [...htlcItems, ...vestingItems, ...userItems],
    })
  } catch (error) {
    console.error('Error fetching UTXOs:', error)
    return NextResponse.json(
      { error: 'Failed to fetch UTXOs', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

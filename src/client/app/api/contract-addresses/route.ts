import { NextResponse } from 'next/server'
import { getScriptInfo } from '@/lib/hydra-utils'
import { validatorToAddress } from '@lucid-evolution/lucid'

/**
 * GET /api/contract-addresses
 * Returns HTLC and Vesting contract addresses computed from plutus.json
 */
export async function GET() {
  try {
    const [htlcScript] = getScriptInfo('htlc')
    const [vestingScript] = getScriptInfo('vesting')
    
    const htlcAddress = validatorToAddress('Custom', { type: 'PlutusV3', script: htlcScript })
    const vestingAddress = validatorToAddress('Custom', { type: 'PlutusV3', script: vestingScript })

    return NextResponse.json({
      htlcContract: {
        address: htlcAddress,
      },
      vestingContractAddress: vestingAddress,
    })
  } catch (error) {
    console.error('Error fetching contract addresses:', error)
    return NextResponse.json(
      { error: 'Failed to fetch contract addresses', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

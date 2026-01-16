'use client'

import { PaymentStep } from './topologies'
import { getUser } from './users'

// Note: This function runs in the background and doesn't have access to React context
// The preimage should be passed from the payment orchestration hook

/**
 * Claim HTLC for an intermediary receiver in the background
 * This is fire-and-forget - doesn't await completion
 */
async function claimIntermediaryHtlc(
  step: PaymentStep,
  htlcHash: string,
  preimage: string,
  amountAda: number
): Promise<void> {
  try {
    const headRoute = `head-${step.from.head}`
    const receiver = step.to.name

    // Wait a bit for the HTLC to be confirmed
    await new Promise((resolve) => setTimeout(resolve, 3000))

    // Find the HTLC UTXO for this intermediary
    const response = await fetch(`/api/hydra/${headRoute}/utxos`, {
      cache: 'no-store',
    })

    if (!response.ok) {
      console.error(`Failed to fetch UTXOs for ${headRoute}:`, response.statusText)
      return
    }

    const data = await response.json()
    const utxos = data.utxos || []

    // Find HTLC UTXO matching:
    // - type is 'htlc'
    // - hash matches the expected hash
    // - receiver (to) matches the intermediary's vkHash
    const receiverUser = getUser(receiver)
    const matchingUtxo = utxos.find((utxo: any) => {
      if (utxo.type !== 'htlc') return false
      if (utxo.hash !== htlcHash) return false
      if (utxo.to !== receiverUser.vkHash) return false
      const utxoAmountLovelace = BigInt(Math.floor(utxo.amountAda * 1_000_000))
      const expectedAmountLovelace = BigInt(Math.floor(amountAda * 1_000_000))
      return utxoAmountLovelace >= expectedAmountLovelace
    })

    if (!matchingUtxo) {
      console.warn(`No matching HTLC UTXO found for ${receiver} in ${headRoute}`)
      return
    }

    // Claim the HTLC in the background (fire and forget)
    fetch(`/api/hydra/${headRoute}/htlc/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        utxoId: matchingUtxo.id,
        preimage: preimage,
        claimerName: receiver,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          return response.json().then((errorData) => {
            throw new Error(errorData.error || errorData.details || 'Failed to claim HTLC')
          })
        }
        return response.json()
      })
      .then((data) => {
        console.log(`Successfully claimed HTLC for ${receiver} in ${headRoute}:`, data.txHash)
      })
      .catch((error) => {
        console.error(`Failed to claim HTLC for ${receiver} in ${headRoute}:`, error)
      })
  } catch (error) {
    console.error(`Error claiming HTLC for intermediary ${step.to.name}:`, error)
  }
}

/**
 * Claim all intermediary HTLCs in the background after payment completes
 */
export function claimIntermediaryHtlcs(
  steps: PaymentStep[],
  htlcHash: string,
  preimage: string,
  amountAda: number
): void {
  // Find all steps where the receiver is an intermediary (ida or jon)
  const intermediarySteps = steps.filter((step) => {
    const automatedIntermediaries = ['ida', 'jon']
    return automatedIntermediaries.includes(step.to.name)
  })

  // Claim each intermediary HTLC in the background (fire and forget)
  intermediarySteps.forEach((step) => {
    claimIntermediaryHtlc(step, htlcHash, preimage, amountAda)
  })
}

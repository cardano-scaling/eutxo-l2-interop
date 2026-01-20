'use client'

import { useState, useCallback, useRef } from 'react'
import { PaymentStep, isAutomatedStep, isIntermediaryReceiver } from './topologies'
import { UserName, getUser } from './users'
import { claimIntermediaryHtlcs } from './claim-intermediary-htlc'

export type StepStatus = 'pending' | 'in-progress' | 'completed' | 'failed' | 'retrying'

export type PaymentStepState = {
  step: PaymentStep
  stepIndex: number
  status: StepStatus
  txHash?: string
  error?: string
  retryCount: number
}

export type PaymentState = {
  steps: PaymentStepState[]
  isExecuting: boolean
  currentStepIndex: number | null
}

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000
const POLL_INTERVAL_MS = 2000
const POLL_MAX_ATTEMPTS = 30 // 60 seconds max wait

/**
 * Check if an HTLC step is confirmed by polling UTXOs
 */
async function waitForStepConfirmation(
  step: PaymentStep,
  expectedHash: string,
  expectedAmountAda: number
): Promise<boolean> {
  const headRoute = `head-${step.from.head}`
  const expectedAmountLovelace = BigInt(Math.floor(expectedAmountAda * 1_000_000))

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`/api/hydra/${headRoute}/utxos`, {
        cache: 'no-store',
      })

      if (!response.ok) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        continue
      }

      const data = await response.json()
      const utxos = data.utxos || []

      // Look for HTLC UTXO matching this step
      const receiverUser = getUser(step.to.name)
      const matchingUtxo = utxos.find((utxo: any) => {
        if (utxo.type !== 'htlc') return false
        if (utxo.hash !== expectedHash) return false
        if (utxo.to !== receiverUser.vkHash) return false // Check receiver vkHash matches
        const utxoAmountLovelace = BigInt(Math.floor(utxo.amountAda * 1_000_000))
        return utxoAmountLovelace >= expectedAmountLovelace
      })

      if (matchingUtxo) {
        return true
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    } catch (error) {
      console.error('Error polling for step confirmation:', error)
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  }

  return false
}

/**
 * Wait for an HTLC to be claimed by polling until the UTXO disappears
 */
async function waitForHtlcClaimed(
  step: PaymentStep,
  expectedHash: string,
  expectedAmountAda: number
): Promise<boolean> {
  const headRoute = `head-${step.from.head}`
  const expectedAmountLovelace = BigInt(Math.floor(expectedAmountAda * 1_000_000))

  // First, wait a bit for the HTLC to be created (if not already confirmed)
  await new Promise((resolve) => setTimeout(resolve, 2000))

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS * 2; attempt++) {
    try {
      const response = await fetch(`/api/hydra/${headRoute}/utxos`, {
        cache: 'no-store',
      })

      if (!response.ok) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        continue
      }

      const data = await response.json()
      const utxos = data.utxos || []

      // Look for HTLC UTXO matching this step
      const receiverUser = getUser(step.to.name)
      const matchingUtxo = utxos.find((utxo: any) => {
        if (utxo.type !== 'htlc') return false
        if (utxo.hash !== expectedHash) return false
        if (utxo.to !== receiverUser.vkHash) return false
        const utxoAmountLovelace = BigInt(Math.floor(utxo.amountAda * 1_000_000))
        return utxoAmountLovelace >= expectedAmountLovelace
      })

      // If HTLC UTXO is not found, it means it was claimed
      if (!matchingUtxo) {
        return true
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    } catch (error) {
      console.error('Error polling for HTLC claim:', error)
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  }

  return false
}

/**
 * Calculate timeout for a step, reducing by 5% for each subsequent step
 * Step 0: 100% of base timeout
 * Step 1: 95% of base timeout
 * Step 2: 90.25% of base timeout (95% of 95%)
 * etc.
 */
function calculateStepTimeout(baseTimeoutMinutes: number, stepIndex: number): string {
  const reductionFactor = Math.pow(0.95, stepIndex)
  const stepTimeoutMinutes = baseTimeoutMinutes * reductionFactor
  // Round to 2 decimal places and convert back to string
  return Math.round(stepTimeoutMinutes * 100) / 100 + ''
}

/**
 * Execute a single HTLC lock step
 */
async function executeStep(
  step: PaymentStep,
  stepIndex: number,
  allSteps: PaymentStep[],
  paymentConfig: {
    amountAda: string
    htlcHash: string
    timeoutMinutes: string
    finalReceiver: UserName // Final target receiver (for last step)
  }
): Promise<{ txHash: string }> {
  const headRoute = `head-${step.from.head}`

  // Calculate desiredOutput for this step:
  // - Last step: use final receiver (the target user)
  // - Intermediary steps: use step.to.name (the receiver who will claim it)
  const isLastStep = stepIndex === allSteps.length - 1
  const desiredOutputReceiver = isLastStep ? paymentConfig.finalReceiver : step.to.name

  const desiredOutput = {
    type: 'user' as const,
    receiver: desiredOutputReceiver,
  }

  // Calculate timeout for this step (reduced by 5% per step)
  const baseTimeoutMinutes = parseFloat(paymentConfig.timeoutMinutes)
  const stepTimeoutMinutes = calculateStepTimeout(baseTimeoutMinutes, stepIndex)

  const requestBody = {
    senderName: step.from.name,
    recipientName: step.to.name,
    amountAda: paymentConfig.amountAda,
    htlcHash: paymentConfig.htlcHash,
    timeoutMinutes: stepTimeoutMinutes,
    desiredOutput,
  }

  const response = await fetch(`/api/hydra/${headRoute}/htlc/lock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const contentType = response.headers.get('content-type')
    let errorData
    try {
      if (contentType && contentType.includes('application/json')) {
        errorData = await response.json()
      } else {
        const text = await response.text()
        throw new Error(`Server error: ${text || response.statusText}`)
      }
    } catch (parseError) {
      throw new Error(`Server error: ${response.statusText}`)
    }
    const errorMsg = errorData?.error || errorData?.details || 'Failed to lock HTLC'
    const fullErrorMsg = errorData?.details
      ? `${errorData.error || 'Failed to lock HTLC'}: ${errorData.details}`
      : errorMsg
    throw new Error(fullErrorMsg)
  }

  const data = await response.json()
  if (!data.txHash) {
    throw new Error('Response missing transaction hash')
  }

  return { txHash: data.txHash }
}

/**
 * Hook for orchestrating multi-step payment execution
 */
export function usePaymentOrchestration() {
  const [paymentState, setPaymentState] = useState<PaymentState | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const isExecutingRef = useRef<boolean>(false)
  const currentStepsRef = useRef<PaymentStepState[]>([])

  const executePayment = useCallback(
    async (
      steps: PaymentStep[],
      paymentConfig: {
        amountAda: string
        htlcHash: string
        timeoutMinutes: string
        finalReceiver: UserName // Final target receiver (for last step)
        preimage?: string // Optional preimage for intermediary claims
      },
      onStepUpdate?: (stepIndex: number, status: StepStatus, txHash?: string, error?: string) => void
    ): Promise<void> => {
      // Prevent concurrent payments
      if (isExecutingRef.current) {
        throw new Error('A payment is already in progress')
      }
      
      isExecutingRef.current = true

      // Initialize payment state
      const initialSteps: PaymentStepState[] = steps.map((step, index) => ({
        step,
        stepIndex: index,
        status: 'pending',
        retryCount: 0,
      }))

      // Store in ref for synchronous access
      currentStepsRef.current = initialSteps

      setPaymentState({
        steps: initialSteps,
        isExecuting: true,
        currentStepIndex: null,
      })

      // Create abort controller for cancellation
      abortControllerRef.current = new AbortController()

      try {
        for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
          // Check if aborted
          if (abortControllerRef.current?.signal.aborted) {
            break
          }

          const step = steps[stepIndex]
          const stepState = initialSteps[stepIndex]

          // Update current step
          setPaymentState((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              currentStepIndex: stepIndex,
            }
          })

          // If automated step, wait for previous step to be confirmed
          if (isAutomatedStep(step) && stepIndex > 0) {
            const previousStep = steps[stepIndex - 1]
            
            // Get previous step state from ref (which is kept in sync with state updates)
            const previousStepState = currentStepsRef.current[stepIndex - 1]

            if (!previousStepState?.txHash) {
              throw new Error('Previous step has no transaction hash')
            }

            // Wait for confirmation
            setPaymentState((prev) => {
              if (!prev) return prev
              const updatedSteps = [...prev.steps]
              updatedSteps[stepIndex] = {
                ...updatedSteps[stepIndex],
                status: 'in-progress',
              }
              currentStepsRef.current = updatedSteps
              return { ...prev, steps: updatedSteps }
            })
            onStepUpdate?.(stepIndex, 'in-progress')

            const confirmed = await waitForStepConfirmation(
              previousStep,
              paymentConfig.htlcHash,
              parseFloat(paymentConfig.amountAda)
            )

            if (!confirmed) {
              throw new Error('Previous step was not confirmed in time')
            }
          }

          // Execute step with retry logic
          let stepCompleted = false
          let lastError: Error | null = null

          for (let retry = 0; retry <= MAX_RETRIES; retry++) {
            // Check if aborted
            if (abortControllerRef.current?.signal.aborted) {
              break
            }

            try {
              // Update status (retrying if not first attempt)
              const status: StepStatus = retry > 0 ? 'retrying' : 'in-progress'
              setPaymentState((prev) => {
                if (!prev) return prev
                const updatedSteps = [...prev.steps]
                updatedSteps[stepIndex] = {
                  ...updatedSteps[stepIndex],
                  status,
                  retryCount: retry,
                  error: retry > 0 ? `Retrying... (attempt ${retry + 1}/${MAX_RETRIES + 1})` : undefined,
                }
                currentStepsRef.current = updatedSteps
                return { ...prev, steps: updatedSteps }
              })
              onStepUpdate?.(stepIndex, status, undefined, retry > 0 ? `Retrying... (attempt ${retry + 1}/${MAX_RETRIES + 1})` : undefined)

              // Execute step
              const result = await executeStep(step, stepIndex, steps, paymentConfig)

              // Update success
              setPaymentState((prev) => {
                if (!prev) return prev
                const updatedSteps = [...prev.steps]
                updatedSteps[stepIndex] = {
                  ...updatedSteps[stepIndex],
                  status: 'completed',
                  txHash: result.txHash,
                  error: undefined,
                }
                // Keep ref in sync
                currentStepsRef.current = updatedSteps
                return { ...prev, steps: updatedSteps }
              })
              onStepUpdate?.(stepIndex, 'completed', result.txHash)

              stepCompleted = true
              break
            } catch (error) {
              lastError = error instanceof Error ? error : new Error(String(error))
              
              if (retry < MAX_RETRIES) {
                // Wait before retry
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
              }
            }
          }

          if (!stepCompleted) {
            // Mark step as failed
            setPaymentState((prev) => {
              if (!prev) return prev
              const updatedSteps = [...prev.steps]
              updatedSteps[stepIndex] = {
                ...updatedSteps[stepIndex],
                status: 'failed',
                error: lastError?.message || 'Step execution failed',
              }
              currentStepsRef.current = updatedSteps
              return { ...prev, steps: updatedSteps }
            })
            onStepUpdate?.(stepIndex, 'failed', undefined, lastError?.message || 'Step execution failed')

            throw lastError || new Error('Step execution failed after retries')
          }

          // Wait for confirmation before proceeding to next step (if not last step)
          if (stepIndex < steps.length - 1) {
            const confirmed = await waitForStepConfirmation(
              step,
              paymentConfig.htlcHash,
              parseFloat(paymentConfig.amountAda)
            )

            if (!confirmed) {
              throw new Error(`Step ${stepIndex + 1} was not confirmed in time`)
            }
          }
        }

        // All steps completed
        isExecutingRef.current = false
        setPaymentState((prev) => {
          if (!prev) return prev
          return { ...prev, isExecuting: false }
        })

        // Wait for the final receiver to claim their HTLC before triggering intermediary claims
        // The final step is the last one in the path
        const finalStep = steps[steps.length - 1]
        
        if (paymentConfig.preimage) {
          // Wait for final HTLC to be claimed in the background (fire and forget)
          // This doesn't block the payment completion
          waitForHtlcClaimed(
            finalStep,
            paymentConfig.htlcHash,
            parseFloat(paymentConfig.amountAda)
          )
            .then((claimed) => {
              if (claimed) {
                console.log('Final HTLC claimed, triggering intermediary HTLC claims')
                // Now trigger intermediary HTLC claims
                claimIntermediaryHtlcs(
                  steps,
                  paymentConfig.htlcHash,
                  paymentConfig.preimage!,
                  parseFloat(paymentConfig.amountAda)
                )
              } else {
                console.warn('Final HTLC was not claimed in time - skipping intermediary HTLC claims')
              }
            })
            .catch((error) => {
              console.error('Error waiting for final HTLC claim:', error)
            })
        } else {
          console.warn('No preimage provided - skipping intermediary HTLC claims')
        }
      } catch (error) {
        // Mark as failed
        isExecutingRef.current = false
        setPaymentState((prev) => {
          if (!prev) return prev
          return { ...prev, isExecuting: false }
        })
        throw error
      }
    },
    [] // No dependencies - uses setPaymentState which is stable
  )

  const cancelPayment = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    isExecutingRef.current = false
    setPaymentState((prev) => {
      if (!prev) return prev
      return { ...prev, isExecuting: false }
    })
  }, [])

  const resetPayment = useCallback(() => {
    abortControllerRef.current = null
    isExecutingRef.current = false
    currentStepsRef.current = []
    setPaymentState(null)
  }, [])

  return {
    paymentState,
    executePayment,
    cancelPayment,
    resetPayment,
  }
}

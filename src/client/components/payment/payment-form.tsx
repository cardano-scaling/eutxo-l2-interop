'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCurrentUser } from '@/lib/use-current-user'
import { useQueryClient } from '@tanstack/react-query'
import { getSelectedTopology } from '@/lib/config'
import { getTopologyConfig, PaymentUser, findPaymentPath } from '@/lib/topologies'
import { usePayment } from '@/contexts/payment-context'
import { usePreimage } from '@/contexts/preimage-context'
import { getAllUsers } from '@/lib/users'

interface PaymentFormProps {
  onSubmissionStart?: () => void
  onSubmissionEnd?: () => void
}

// Get recipient options (only actual users, not intermediaries)
const RECIPIENT_OPTIONS = getAllUsers()
  .filter((user) => ['alice', 'bob', 'charlie'].includes(user.name))
  .map((user) => ({
    name: user.name as PaymentUser,
    address: user.address,
  }))

export default function PaymentForm({
  onSubmissionStart,
  onSubmissionEnd,
}: PaymentFormProps) {
  const pathname = usePathname()
  const { currentUser } = useCurrentUser()
  const queryClient = useQueryClient()
  const { executePayment, paymentState, resetPayment } = usePayment()
  const { markAsUsed, getPreimage } = usePreimage()
  
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  const [form, setForm] = useState({
    toUserAndHead: '', // Format: "user:head-a" e.g., "bob:head-b"
    amountAda: '',
    htlcHash: '',
    timeout: '60', // in minutes
  })

  // Get topology on client side only to avoid hydration mismatch
  const [topologyId, setTopologyId] = useState<string | null>(null)
  const [topology, setTopology] = useState<ReturnType<typeof getTopologyConfig> | null>(null)

  useEffect(() => {
    // Only read from localStorage on client side
    const selectedTopology = getSelectedTopology()
    setTopologyId(selectedTopology)
    if (selectedTopology) {
      setTopology(getTopologyConfig(selectedTopology))
    } else {
      setTopology(null)
    }

    // Listen for topology changes
    const handleTopologyChange = () => {
      const newTopologyId = getSelectedTopology()
      setTopologyId(newTopologyId)
      if (newTopologyId) {
        setTopology(getTopologyConfig(newTopologyId))
      } else {
        setTopology(null)
      }
    }

    window.addEventListener('topology-changed', handleTopologyChange)
    return () => {
      window.removeEventListener('topology-changed', handleTopologyChange)
    }
  }, [])

  // Only allow PaymentUsers (alice, bob, charlie) as current user
  const currentUserIsPaymentUser = currentUser && ['alice', 'bob', 'charlie'].includes(currentUser)

  // Get available user-head combinations based on payment paths
  const availableUserHeadCombinations = useMemo(() => {
    if (!topology || !currentUserIsPaymentUser) return []
    
    const fromUser = currentUser as PaymentUser
    const fromHead = pathname?.replace('/', '') as `head-${'a' | 'b' | 'c'}` || 'head-a'
    const userPaths = topology.paymentPaths[fromUser]
    if (!userPaths) return []
    
    // Build list of valid user-head combinations
    const combinations: Array<{ value: string; label: string; user: PaymentUser; head: string }> = []
    
    // Iterate through all users that have payment paths
    Object.keys(userPaths).forEach((toUserStr) => {
      const toUser = toUserStr as PaymentUser
      
      // Check all heads for this user
      topology.heads.forEach((head) => {
        // Check if head has the user as a node
        const hasUser = head.nodes[toUser] !== undefined
        if (!hasUser) return
        
        // Check if payment path exists
        const path = findPaymentPath(topology, fromUser, fromHead, toUser, head.route as `head-${'a' | 'b' | 'c'}`)
        if (path !== null && path.length > 0) {
          const userName = toUser.charAt(0).toUpperCase() + toUser.slice(1)
          combinations.push({
            value: `${toUser}:${head.route}`,
            label: `${userName} - ${head.name}`,
            user: toUser,
            head: head.route,
          })
        }
      })
    })
    
    return combinations
  }, [topology, currentUserIsPaymentUser, currentUser, pathname])

  // Parse selected user and head from combined value
  const selectedUserAndHead = useMemo(() => {
    if (!form.toUserAndHead) return { user: null, head: null }
    const [user, head] = form.toUserAndHead.split(':')
    return {
      user: user as PaymentUser | null,
      head: head as `head-${'a' | 'b' | 'c'}` | null,
    }
  }, [form.toUserAndHead])

  // Get payment path when form changes
  const paymentPath = selectedUserAndHead.user && selectedUserAndHead.head && topologyId && currentUserIsPaymentUser
    ? findPaymentPath(
        topology,
        currentUser as PaymentUser,
        pathname?.replace('/', '') as `head-${'a' | 'b' | 'c'}` || 'head-a',
        selectedUserAndHead.user,
        selectedUserAndHead.head
      )
    : null

  const getClipboardContents = async () => {
    try {
      const text = await navigator.clipboard.readText()
      return text
    } catch (error) {
      console.error('Failed to read clipboard contents: ', error)
    }
  }

  const pasteTo = async (field: 'amountAda' | 'htlcHash') => {
    const clipboardText = await getClipboardContents()
    if (clipboardText && field in form) {
      if (field === 'amountAda') {
        setForm((prev) => ({
          ...prev,
          [field]: isNaN(Number(clipboardText)) ? '' : clipboardText,
        }))
      } else {
        setForm((prev) => ({ ...prev, [field]: clipboardText }))
      }
    }
  }

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current)
      }
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setIsSubmitting(true)
    
    // Pause UTXO list refreshing during submission
    onSubmissionStart?.()

    // Clear any existing timeouts
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current)
    }

    try {
      // Validate form
      if (!form.toUserAndHead || !form.amountAda || !form.htlcHash) {
        throw new Error('Please fill in all required fields')
      }

      if (!selectedUserAndHead.user || !selectedUserAndHead.head) {
        throw new Error('Invalid user/head selection')
      }

      if (!paymentPath || paymentPath.length === 0) {
        throw new Error('No payment path found for the selected route')
      }

      if (!topologyId) {
        throw new Error('No topology selected')
      }

      // Mark hash as used (indefinite lifetime) if it exists in context
      markAsUsed(form.htlcHash)

      // Get preimage from context for intermediary claims
      const preimage = getPreimage(form.htlcHash)

      // Execute payment
      // Note: desiredOutput is now calculated per-step in use-payment-orchestration
      await executePayment(
        paymentPath,
        {
          amountAda: form.amountAda,
          htlcHash: form.htlcHash,
          timeoutMinutes: form.timeout,
          finalReceiver: selectedUserAndHead.user, // Final target receiver
          preimage: preimage || undefined, // Get preimage from context
        },
        (stepIndex, status, txHash, error) => {
          // Step update callback - can be used for additional UI updates
          console.log(`Step ${stepIndex} ${status}`, { txHash, error })
        }
      )

      const successMessage = 'Payment completed successfully!'
      setSuccess(successMessage)
      
      // Reset form
      setForm({
        toUserAndHead: '',
        amountAda: '',
        htlcHash: '',
        timeout: '60',
      })

      // Resume UTXO list refreshing and invalidate to show new HTLCs
      onSubmissionEnd?.()
      const headRoute = pathname?.replace('/', '') || 'head-a'
      queryClient.invalidateQueries({ queryKey: ['utxos', headRoute] })

      // Set success to null after 5 seconds
      successTimeoutRef.current = setTimeout(() => {
        setSuccess(null)
        // resetPayment()
      }, 5000)
    } catch (err) {
      // Resume UTXO list refreshing even on error
      onSubmissionEnd?.()
      setError(err instanceof Error ? err.message : 'Failed to execute payment')
    } finally {
      setIsSubmitting(false)
    }
  }

  const canSubmit = 
    !isSubmitting &&
    !paymentState?.isExecuting &&
    form.toUserAndHead &&
    form.amountAda &&
    form.htlcHash &&
    paymentPath &&
    paymentPath.length > 0

  return (
    <Card className="flex flex-col w-[600px] h-full overflow-hidden">
      <CardHeader className="p-0 -m-[1px] flex-shrink-0">
        <CardTitle className="text-center bg-primary text-primary-foreground py-8 rounded-t-lg">
          PAYMENT FORM
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Payment Path Preview */}
        {paymentPath && paymentPath.length > 0 && (
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-sm font-medium text-blue-900 mb-2">Payment Path:</p>
            <div className="space-y-1">
              {paymentPath.map((step, index) => (
                <p key={index} className="text-xs text-blue-700">
                  Step {index + 1}: {capitalizeFirstLetter(step.from.name)} → {capitalizeFirstLetter(step.to.name)} (Head {step.from.head.toUpperCase()})
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Success Message */}
        {success && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800">{success}</p>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* To User */}
          <div className="space-y-2">
            <Label htmlFor="toUser">To User *</Label>
            <Select
              value={form.toUserAndHead}
              onValueChange={(value) => setForm((prev) => ({ 
                ...prev, 
                toUserAndHead: value
              }))}
              disabled={isSubmitting || paymentState?.isExecuting || availableUserHeadCombinations.length === 0}
            >
              <SelectTrigger id="toUser" className="w-full">
                <SelectValue placeholder={
                  availableUserHeadCombinations.length === 0 
                    ? "No recipients available" 
                    : "Select recipient"
                } />
              </SelectTrigger>
              <SelectContent>
                {availableUserHeadCombinations.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No payment paths available
                  </div>
                ) : (
                  <SelectGroup>
                    <SelectLabel>Recipients</SelectLabel>
                    {availableUserHeadCombinations.map((combination) => (
                      <SelectItem key={combination.value} value={combination.value}>
                        {combination.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="amountAda">Amount (ADA) *</Label>
            <div className="flex gap-2">
              <Input
                id="amountAda"
                type="number"
                step="0.000001"
                min="0"
                value={form.amountAda}
                onChange={(e) => setForm((prev) => ({ ...prev, amountAda: e.target.value }))}
                disabled={isSubmitting || paymentState?.isExecuting}
                placeholder="0.0"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => pasteTo('amountAda')}
                disabled={isSubmitting || paymentState?.isExecuting}
              >
                Paste
              </Button>
            </div>
          </div>

          {/* HTLC Hash */}
          <div className="space-y-2">
            <Label htmlFor="htlcHash">HTLC Hash *</Label>
            <div className="flex gap-2">
              <Input
                id="htlcHash"
                type="text"
                value={form.htlcHash}
                onChange={(e) => setForm((prev) => ({ ...prev, htlcHash: e.target.value }))}
                disabled={isSubmitting || paymentState?.isExecuting}
                placeholder="Enter hash"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => pasteTo('htlcHash')}
                disabled={isSubmitting || paymentState?.isExecuting}
              >
                Paste
              </Button>
            </div>
          </div>

          {/* Timeout */}
          <div className="space-y-2">
            <Label htmlFor="timeout">Timeout (minutes) *</Label>
            <Input
              id="timeout"
              type="number"
              min="1"
              value={form.timeout}
              onChange={(e) => setForm((prev) => ({ ...prev, timeout: e.target.value }))}
              disabled={isSubmitting || paymentState?.isExecuting}
            />
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            className="w-full"
            disabled={!canSubmit}
          >
            {isSubmitting || paymentState?.isExecuting
              ? 'Processing Payment...'
              : 'Send Payment'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function capitalizeFirstLetter(string: string) {
  return string.charAt(0).toUpperCase() + string.slice(1)
}

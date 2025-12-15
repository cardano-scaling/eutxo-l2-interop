'use client'

import { use } from 'react'
import { hydraHeads, htlcContract, vestingContractAddress } from '@/lib/config'
import HtlcSenderForm from '@/components/htlc/htlc-sender-form'
import HtlcUtxosList from '@/components/htlc/htlc-utxos-list'
import { HtlcUtxoItem } from '@/components/htlc/htlc-utxo-item'
import { formatId } from '@/lib/utils'
import { useCurrentUser } from '@/lib/use-current-user'

interface PageProps {
  params: Promise<{ headRoute: string }>
}

export default function HeadDashboardPage({ params }: PageProps) {
  const { headRoute } = use(params)
  const headConfig = hydraHeads.find((head) => head.route === headRoute)
  const { currentUserVkHash } = useCurrentUser()

  if (!headConfig) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-4">Head not found</h1>
        <p>Head route &quot;{headRoute}&quot; not found.</p>
      </div>
    )
  }

  // Mock UTXOs for testing
  const now = Date.now()
  const mockUtxos: HtlcUtxoItem[] = [
    // HTLC UTXOs
    {
      id: 'htlc_tx1#0',
      hash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
      timeout: now + 3600000, // 1 hour from now - claimable
      from: 'addr_test1qqsender111111111111111111111111111111111111111111111111',
      to: 'addr_test1qqreceiver11111111111111111111111111111111111111111111111',
      amountAda: 10,
      address: htlcContract.address, // HTLC address
    },
    {
      id: 'htlc_tx2#0',
      hash: 'b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef12345678',
      timeout: now - 120000, // 2 minutes ago - refundable
      from: 'addr_test1qqsender222222222222222222222222222222222222222222222222',
      to: 'addr_test1qqreceiver22222222222222222222222222222222222222222222222',
      amountAda: 25,
      address: htlcContract.address, // HTLC address
    },
    {
      id: 'htlc_tx3#0',
      hash: 'c3d4e5f6789012345678901234567890abcdef1234567890abcdef1234567890',
      timeout: now + 7200000, // 2 hours from now - claimable
      from: 'addr_test1qqsender333333333333333333333333333333333333333333333333',
      to: 'addr_test1qqreceiver33333333333333333333333333333333333333333333333',
      amountAda: 50,
      address: htlcContract.address, // HTLC address
    },
    // Vesting UTXOs
    {
      id: 'vesting_tx1#0',
      hash: 'd4e5f6789012345678901234567890abcdef1234567890abcdef1234567890ab',
      timeout: now - 60000, // 1 minute ago - claimable (vesting can be claimed after timeout)
      from: 'addr_test1qqsender444444444444444444444444444444444444444444444444',
      to: 'addr_test1qqreceiver44444444444444444444444444444444444444444444444',
      amountAda: 100,
      address: vestingContractAddress, // Vesting address
    },
    {
      id: 'vesting_tx2#0',
      hash: 'e5f6789012345678901234567890abcdef1234567890abcdef1234567890abcd',
      timeout: now + 1800000, // 30 minutes from now - not yet claimable
      from: 'addr_test1qqsender555555555555555555555555555555555555555555555555',
      to: 'addr_test1qqreceiver55555555555555555555555555555555555555555555555',
      amountAda: 200,
      address: vestingContractAddress, // Vesting address
    },
    {
      id: 'vesting_tx3#0',
      hash: 'f6789012345678901234567890abcdef1234567890abcdef1234567890abcdef',
      timeout: now - 300000, // 5 minutes ago - claimable
      from: 'addr_test1qqsender666666666666666666666666666666666666666666666666',
      to: 'addr_test1qqreceiver66666666666666666666666666666666666666666666666',
      amountAda: 75,
      address: vestingContractAddress, // Vesting address
    },
  ]

  // Current user vkHash from context - you'll populate this from your Hydra provider

  const handleClaim = (txHash: string, preimage?: string) => {
    console.log('Claim UTXO:', txHash, preimage ? `with preimage: ${preimage}` : '(vesting, no preimage needed)')
    // Your claim logic - preimage will be provided for HTLC, undefined for vesting
  }

  const handleRefund = (txHash: string) => {
    console.log('Refund HTLC:', txHash)
    // Your refund logic
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-sm text-muted-foreground">
              <p>{headConfig.name}</p>
              <p className="font-mono">ID: {formatId(headConfig.headId)}</p>
              <p className="font-mono">Seed: {formatId(headConfig.headSeed)}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Content Grid */}
      <div className="flex-1 flex gap-6 p-6 overflow-hidden">
        {/* Left Panel - HTLC Sender Form */}
        <HtlcSenderForm
          onRecipientChange={(recipientName, recipientAddress) => {
            // Recipient name and address are provided
            // You'll use this when building the HTLC transaction
            console.log('Recipient selected:', recipientName, 'Address:', recipientAddress)
          }}
        />

        {/* Right Panel - HTLC UTXOs List */}
        <HtlcUtxosList
          utxos={mockUtxos}
          currentUserVkeyHash={currentUserVkHash}
          onClaim={handleClaim}
          onRefund={handleRefund}
        />
      </div>
    </div>
  )
}

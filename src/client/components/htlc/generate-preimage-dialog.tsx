'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Copy, RefreshCw } from 'lucide-react'

interface GeneratePreimageDialogProps {
  children: React.ReactNode
}

export default function GeneratePreimageDialog({
  children,
}: GeneratePreimageDialogProps) {
  const [open, setOpen] = useState(false)
  const [preimage, setPreimage] = useState('')
  const [htlcHash, setHtlcHash] = useState('')
  const [previousPreimage, setPreviousPreimage] = useState('')
  const [previousHash, setPreviousHash] = useState('')

  const stringToHex = (str: string): string => {
    return Array.from(str)
      .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('')
  }

  const generateHash = (preimage: string): string => {
    // Simple hash simulation - you'll replace this with actual blake2b
    return preimage.slice(0, 64).padEnd(64, '0')
  }

  const generatePreimage = () => {
    // Save current values before generating new ones
    if (preimage && htlcHash) {
      setPreviousPreimage(preimage)
      setPreviousHash(htlcHash)
    }
    
    const randomText = crypto.randomUUID()
    const newPreimage = stringToHex(randomText)
    const newHash = generateHash(newPreimage)
    setPreimage(newPreimage)
    setHtlcHash(newHash)
    
    // Automatically copy hash to clipboard
    navigator.clipboard.writeText(newHash)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (!isOpen) {
      // Reset when dialog closes
      setPreimage('')
      setHtlcHash('')
      setPreviousPreimage('')
      setPreviousHash('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate Preimage & Hash</DialogTitle>
          <DialogDescription>
            Click the regenerate button to generate a new preimage and its HTLC hash.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Previous values display */}
          {previousPreimage && previousHash && (
            <div className="space-y-2 p-3 bg-muted rounded-md">
              <Label className="text-xs font-medium text-muted-foreground">Previous (saved)</Label>
              <div className="space-y-1">
                <div className="text-xs font-mono break-all text-muted-foreground">
                  Preimage: {previousPreimage}
                </div>
                <div className="text-xs font-mono break-all text-muted-foreground">
                  Hash: {previousHash}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex w-full justify-between items-center">
              <Label className="text-sm font-medium block">Preimage</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="p-0 px-1 h-auto"
                onClick={generatePreimage}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                {preimage ? 'Regenerate' : 'Generate'}
              </Button>
            </div>
            <div className="flex gap-2">
              <Textarea
                placeholder="Click 'Generate' to create a preimage"
                value={preimage}
                readOnly
                rows={3}
                className="break-all font-mono text-xs"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => copyToClipboard(preimage)}
                disabled={!preimage}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium block">HTLC Hash</Label>
            <div className="flex gap-2">
              <Textarea
                placeholder="Hash will appear here after generation"
                value={htlcHash}
                readOnly
                rows={2}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => copyToClipboard(htlcHash)}
                disabled={!htlcHash}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            {htlcHash && (
              <p className="text-xs text-muted-foreground">
                Hash has been copied to clipboard automatically
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

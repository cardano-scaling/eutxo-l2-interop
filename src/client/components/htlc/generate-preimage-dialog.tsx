'use client'

import { useState, useEffect } from 'react'
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

  // Generate preimage when dialog opens
  useEffect(() => {
    if (open) {
      const randomText = crypto.randomUUID()
      const newPreimage = stringToHex(randomText)
      const newHash = generateHash(newPreimage)
      setPreimage(newPreimage)
      setHtlcHash(newHash)
      
      // Automatically copy hash to clipboard
      navigator.clipboard.writeText(newHash)
    } else {
      // Reset when dialog closes
      setPreimage('')
      setHtlcHash('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate Preimage & Hash</DialogTitle>
          <DialogDescription>
            Generate a preimage and its HTLC hash. The hash has been copied to
            your clipboard automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
                Regenerate
              </Button>
            </div>
            <div className="flex gap-2">
              <Textarea
                placeholder="Preimage will appear here"
                value={preimage}
                readOnly
                rows={3}
                className="break-all font-mono text-xs"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => copyToClipboard(preimage)}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium block">HTLC Hash</Label>
            <div className="flex gap-2">
              <Textarea
                placeholder="Hash will appear here"
                value={htlcHash}
                readOnly
                rows={2}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => copyToClipboard(htlcHash)}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Hash has been copied to clipboard automatically
            </p>
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

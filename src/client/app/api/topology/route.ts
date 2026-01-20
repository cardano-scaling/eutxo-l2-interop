import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { TopologyId } from '@/lib/topologies'

const COOKIE_NAME = 'hydra-topology'

/**
 * POST /api/topology
 * Set the topology in a cookie (for server-side API routes)
 * Note: Client reads topology from localStorage directly, no GET endpoint needed
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { topology } = body

    if (!topology || !['two-heads', 'single-path', 'hub-and-spoke'].includes(topology)) {
      return NextResponse.json(
        { error: 'Invalid topology' },
        { status: 400 }
      )
    }

    const cookieStore = await cookies()
    cookieStore.set(COOKIE_NAME, topology, {
      httpOnly: true, // Security: prevent client JS access
      sameSite: 'lax',
      path: '/',
      // No expires/maxAge means session cookie (cleared when browser closes)
      // If you want persistence across sessions, add maxAge
    })

    return NextResponse.json({ success: true, topology })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to set topology' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/topology
 * Clear the topology cookie
 */
export async function DELETE() {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
  
  return NextResponse.json({ success: true })
}

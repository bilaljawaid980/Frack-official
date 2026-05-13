import { NextRequest, NextResponse } from 'next/server';

function getBackendUrl() {
  const raw = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';
  return raw.replace(/\/+$/, '');
}

// POST /api/rwa/mint - Mint tokens for an asset
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tokenMint, recipient, amount, agentWallet } = body;

    if (!tokenMint || !recipient || !amount) {
      return NextResponse.json(
        { success: false, error: 'Token mint, recipient, and amount are required' },
        { status: 400 }
      );
    }

    const backendUrl = getBackendUrl();
    const response = await fetch(`${backendUrl}/rwa/mint`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: request.headers.get('authorization') || '',
      },
      body: JSON.stringify({ tokenMint, recipient, amount, agentWallet }),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { success: false, error: text || 'Mint failed' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('Token Minting Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
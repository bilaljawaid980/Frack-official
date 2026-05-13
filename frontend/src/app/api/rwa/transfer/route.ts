import { NextRequest, NextResponse } from 'next/server';

function getBackendUrl() {
  const raw = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';
  return raw.replace(/\/+$/, '');
}

// POST /api/rwa/transfer - Transfer tokens
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tokenMint, from, to, amount, agentWallet } = body;

    if (!tokenMint || !from || !to || !amount) {
      return NextResponse.json(
        { success: false, error: 'Token mint, sender, recipient, and amount are required' },
        { status: 400 }
      );
    }

    const backendUrl = getBackendUrl();
    const response = await fetch(`${backendUrl}/rwa/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: request.headers.get('authorization') || '',
      },
      body: JSON.stringify({ tokenMint, from, to, amount, agentWallet }),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { success: false, error: text || 'Transfer failed' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('Token Transfer Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
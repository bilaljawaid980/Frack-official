import { NextRequest, NextResponse } from 'next/server';

function getBackendUrl() {
  const raw = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';
  return raw.replace(/\/+$/, '');
}

// POST /api/rwa/compliance - Update compliance status
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tokenMint, status, requirements } = body;

    if (!tokenMint || !status) {
      return NextResponse.json(
        { success: false, error: 'Token mint and status are required' },
        { status: 400 }
      );
    }

    const backendUrl = getBackendUrl();
    const response = await fetch(`${backendUrl}/rwa/compliance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: request.headers.get('authorization') || '',
      },
      body: JSON.stringify({ tokenMint, status, requirements: requirements || {} }),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { success: false, error: text || 'Compliance update failed' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('Compliance Update Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// GET /api/rwa/compliance - Check compliance for asset
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const tokenMint = searchParams.get('tokenMint');
    const investorAddress = searchParams.get('investorAddress');

    if (!tokenMint || !investorAddress) {
      return NextResponse.json(
        { success: false, error: 'Token mint and investor address are required' },
        { status: 400 }
      );
    }

    const backendUrl = getBackendUrl();
    const url = `${backendUrl}/rwa/compliance?tokenMint=${encodeURIComponent(
      tokenMint,
    )}&investorAddress=${encodeURIComponent(investorAddress)}`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: request.headers.get('authorization') || '',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { success: false, error: text || 'Compliance query failed' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('Compliance Check Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
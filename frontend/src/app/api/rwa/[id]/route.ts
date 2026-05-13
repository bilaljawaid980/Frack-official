import { NextRequest, NextResponse } from 'next/server';

function getBackendUrl() {
  const raw = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';
  return raw.replace(/\/+$/, '');
}

// GET /api/rwa/[id] - Get specific RWA asset
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: assetId } = await params;

    if (!assetId) {
      return NextResponse.json(
        { success: false, error: 'Asset ID is required' },
        { status: 400 }
      );
    }

    const backendUrl = getBackendUrl();
    const response = await fetch(`${backendUrl}/indexed/assets`, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { success: false, error: text || 'Failed to fetch assets' },
        { status: response.status }
      );
    }

    const assets = (await response.json()) as Array<{ id: string; factoryAssetId?: number | null }>;
    const match = assets.find(
      (asset) => asset.id === assetId || asset.factoryAssetId?.toString() === assetId
    );

    if (!match) {
      return NextResponse.json(
        { success: false, error: 'Asset not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: match });
  } catch (error: any) {
    console.error('RWA Asset Fetch Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// DELETE /api/rwa/[id] - Delete RWA asset (soft delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: assetId } = await params;

    if (!assetId) {
      return NextResponse.json(
        { success: false, error: 'Asset ID is required' },
        { status: 400 }
      );
    }

    const backendUrl = getBackendUrl();
    const response = await fetch(`${backendUrl}/assets/${assetId}`, {
      method: 'DELETE',
      headers: {
        Authorization: request.headers.get('authorization') || '',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { success: false, error: text || 'Failed to delete asset' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('RWA Delete Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
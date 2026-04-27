import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { dbGet } from '@/lib/db';
import { handleApiError } from '@/lib/errorHandler';

export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (authResult instanceof NextResponse) return authResult;

    const row = await dbGet<{ email: string; created_at: string }>(
      'SELECT email, created_at FROM users WHERE email = ?',
      [authResult.userEmail]
    );

    if (!row) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      user: { email: row.email, createdAt: row.created_at },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

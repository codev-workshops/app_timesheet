import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { dbGet, dbAll } from '@/lib/db';
import { handleApiError } from '@/lib/errorHandler';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const authResult = await authenticateRequest(request);
    if (authResult instanceof NextResponse) return authResult;

    const { clientId: clientIdStr } = await params;
    const clientId = parseInt(clientIdStr);
    if (isNaN(clientId)) {
      return NextResponse.json({ error: 'Invalid client ID' }, { status: 400 });
    }

    const client = await dbGet<{ id: number; name: string }>(
      'SELECT id, name FROM clients WHERE id = ? AND user_email = ?',
      [clientId, authResult.userEmail]
    );

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    const workEntries = await dbAll<{
      id: number;
      hours: number;
      description: string | null;
      date: string;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, hours, description, date, created_at, updated_at
       FROM work_entries
       WHERE client_id = ? AND user_email = ?
       ORDER BY date DESC`,
      [clientId, authResult.userEmail]
    );

    const totalHours = workEntries.reduce(
      (sum, entry) => sum + parseFloat(String(entry.hours)),
      0
    );

    return NextResponse.json({
      client,
      workEntries,
      totalHours,
      entryCount: workEntries.length,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

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
      hours: number;
      description: string | null;
      date: string;
      created_at: string;
    }>(
      `SELECT hours, description, date, created_at
       FROM work_entries
       WHERE client_id = ? AND user_email = ?
       ORDER BY date DESC`,
      [clientId, authResult.userEmail]
    );

    const header = 'Date,Hours,Description,Created At\n';
    const rows = workEntries
      .map((entry) => {
        const desc = (entry.description || '').replace(/"/g, '""');
        return `${entry.date},${entry.hours},"${desc}",${entry.created_at}`;
      })
      .join('\n');

    const csv = header + rows;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${client.name.replace(/[^a-zA-Z0-9]/g, '_')}_report_${timestamp}.csv`;

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

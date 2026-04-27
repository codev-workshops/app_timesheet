import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { dbAll, dbRun, dbGet } from '@/lib/db';
import { workEntrySchema } from '@/lib/validation';
import { handleApiError } from '@/lib/errorHandler';

export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (authResult instanceof NextResponse) return authResult;

    const clientId = request.nextUrl.searchParams.get('clientId');
    let query = `
      SELECT we.id, we.client_id, we.hours, we.description, we.date,
             we.created_at, we.updated_at, c.name as client_name
      FROM work_entries we
      JOIN clients c ON we.client_id = c.id
      WHERE we.user_email = ?
    `;
    const params: unknown[] = [authResult.userEmail];

    if (clientId) {
      const clientIdNum = parseInt(clientId);
      if (isNaN(clientIdNum)) {
        return NextResponse.json({ error: 'Invalid client ID' }, { status: 400 });
      }
      query += ' AND we.client_id = ?';
      params.push(clientIdNum);
    }

    query += ' ORDER BY we.date DESC, we.created_at DESC';

    const rows = await dbAll(query, params);
    return NextResponse.json({ workEntries: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (authResult instanceof NextResponse) return authResult;

    const body = await request.json();
    const { error, value } = workEntrySchema.validate(body);
    if (error) {
      return NextResponse.json(
        { error: 'Validation error', details: error.details.map((d) => d.message) },
        { status: 400 }
      );
    }

    const { clientId, hours, description, date } = value;

    const clientRow = await dbGet(
      'SELECT id FROM clients WHERE id = ? AND user_email = ?',
      [clientId, authResult.userEmail]
    );

    if (!clientRow) {
      return NextResponse.json(
        { error: 'Client not found or does not belong to user' },
        { status: 400 }
      );
    }

    const result = await dbRun(
      'INSERT INTO work_entries (client_id, user_email, hours, description, date) VALUES (?, ?, ?, ?, ?)',
      [clientId, authResult.userEmail, hours, description || null, date]
    );

    const row = await dbGet(
      `SELECT we.id, we.client_id, we.hours, we.description, we.date,
              we.created_at, we.updated_at, c.name as client_name
       FROM work_entries we
       JOIN clients c ON we.client_id = c.id
       WHERE we.id = ?`,
      [result.lastID]
    );

    return NextResponse.json(
      { message: 'Work entry created successfully', workEntry: row },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { dbGet, dbRun } from '@/lib/db';
import { updateWorkEntrySchema } from '@/lib/validation';
import { handleApiError } from '@/lib/errorHandler';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await authenticateRequest(request);
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;
    const workEntryId = parseInt(id);
    if (isNaN(workEntryId)) {
      return NextResponse.json({ error: 'Invalid work entry ID' }, { status: 400 });
    }

    const row = await dbGet(
      `SELECT we.id, we.client_id, we.hours, we.description, we.date,
              we.created_at, we.updated_at, c.name as client_name
       FROM work_entries we
       JOIN clients c ON we.client_id = c.id
       WHERE we.id = ? AND we.user_email = ?`,
      [workEntryId, authResult.userEmail]
    );

    if (!row) {
      return NextResponse.json({ error: 'Work entry not found' }, { status: 404 });
    }

    return NextResponse.json({ workEntry: row });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await authenticateRequest(request);
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;
    const workEntryId = parseInt(id);
    if (isNaN(workEntryId)) {
      return NextResponse.json({ error: 'Invalid work entry ID' }, { status: 400 });
    }

    const body = await request.json();
    const { error, value } = updateWorkEntrySchema.validate(body);
    if (error) {
      return NextResponse.json(
        { error: 'Validation error', details: error.details.map((d) => d.message) },
        { status: 400 }
      );
    }

    const existing = await dbGet(
      'SELECT id FROM work_entries WHERE id = ? AND user_email = ?',
      [workEntryId, authResult.userEmail]
    );

    if (!existing) {
      return NextResponse.json({ error: 'Work entry not found' }, { status: 404 });
    }

    if (value.clientId) {
      const clientRow = await dbGet(
        'SELECT id FROM clients WHERE id = ? AND user_email = ?',
        [value.clientId, authResult.userEmail]
      );
      if (!clientRow) {
        return NextResponse.json(
          { error: 'Client not found or does not belong to user' },
          { status: 400 }
        );
      }
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (value.clientId !== undefined) {
      updates.push('client_id = ?');
      values.push(value.clientId);
    }
    if (value.hours !== undefined) {
      updates.push('hours = ?');
      values.push(value.hours);
    }
    if (value.description !== undefined) {
      updates.push('description = ?');
      values.push(value.description || null);
    }
    if (value.date !== undefined) {
      updates.push('date = ?');
      values.push(value.date);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(workEntryId, authResult.userEmail);

    await dbRun(
      `UPDATE work_entries SET ${updates.join(', ')} WHERE id = ? AND user_email = ?`,
      values
    );

    const row = await dbGet(
      `SELECT we.id, we.client_id, we.hours, we.description, we.date,
              we.created_at, we.updated_at, c.name as client_name
       FROM work_entries we
       JOIN clients c ON we.client_id = c.id
       WHERE we.id = ?`,
      [workEntryId]
    );

    return NextResponse.json({ message: 'Work entry updated successfully', workEntry: row });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await authenticateRequest(request);
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;
    const workEntryId = parseInt(id);
    if (isNaN(workEntryId)) {
      return NextResponse.json({ error: 'Invalid work entry ID' }, { status: 400 });
    }

    const existing = await dbGet(
      'SELECT id FROM work_entries WHERE id = ? AND user_email = ?',
      [workEntryId, authResult.userEmail]
    );

    if (!existing) {
      return NextResponse.json({ error: 'Work entry not found' }, { status: 404 });
    }

    await dbRun('DELETE FROM work_entries WHERE id = ? AND user_email = ?', [
      workEntryId,
      authResult.userEmail,
    ]);

    return NextResponse.json({ message: 'Work entry deleted successfully' });
  } catch (err) {
    return handleApiError(err);
  }
}

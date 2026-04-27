import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { dbGet, dbRun } from '@/lib/db';
import { updateClientSchema } from '@/lib/validation';
import { handleApiError } from '@/lib/errorHandler';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await authenticateRequest(request);
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;
    const clientId = parseInt(id);
    if (isNaN(clientId)) {
      return NextResponse.json({ error: 'Invalid client ID' }, { status: 400 });
    }

    const row = await dbGet(
      'SELECT id, name, description, department, email, created_at, updated_at FROM clients WHERE id = ? AND user_email = ?',
      [clientId, authResult.userEmail]
    );

    if (!row) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    return NextResponse.json({ client: row });
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
    const clientId = parseInt(id);
    if (isNaN(clientId)) {
      return NextResponse.json({ error: 'Invalid client ID' }, { status: 400 });
    }

    const body = await request.json();
    const { error, value } = updateClientSchema.validate(body);
    if (error) {
      return NextResponse.json(
        { error: 'Validation error', details: error.details.map((d) => d.message) },
        { status: 400 }
      );
    }

    const existing = await dbGet(
      'SELECT id FROM clients WHERE id = ? AND user_email = ?',
      [clientId, authResult.userEmail]
    );

    if (!existing) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (value.name !== undefined) {
      updates.push('name = ?');
      values.push(value.name);
    }
    if (value.description !== undefined) {
      updates.push('description = ?');
      values.push(value.description || null);
    }
    if (value.department !== undefined) {
      updates.push('department = ?');
      values.push(value.department || null);
    }
    if (value.email !== undefined) {
      updates.push('email = ?');
      values.push(value.email || null);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(clientId, authResult.userEmail);

    await dbRun(
      `UPDATE clients SET ${updates.join(', ')} WHERE id = ? AND user_email = ?`,
      values
    );

    const row = await dbGet(
      'SELECT id, name, description, department, email, created_at, updated_at FROM clients WHERE id = ?',
      [clientId]
    );

    return NextResponse.json({ message: 'Client updated successfully', client: row });
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
    const clientId = parseInt(id);
    if (isNaN(clientId)) {
      return NextResponse.json({ error: 'Invalid client ID' }, { status: 400 });
    }

    const existing = await dbGet(
      'SELECT id FROM clients WHERE id = ? AND user_email = ?',
      [clientId, authResult.userEmail]
    );

    if (!existing) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    await dbRun('DELETE FROM clients WHERE id = ? AND user_email = ?', [
      clientId,
      authResult.userEmail,
    ]);

    return NextResponse.json({ message: 'Client deleted successfully' });
  } catch (err) {
    return handleApiError(err);
  }
}

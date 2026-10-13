'use server';
import { createClient } from '@/lib/supabase/server';
import { CreateClaimSchema, MoveClaimSchema, ToggleVideoReviewSchema } from '@/lib/validators';
import { sendEmail } from '@/lib/email/smtp';
import { assignmentEmail } from '@/lib/email/templates';
import type { ClaimColumn } from '@/lib/columns';
import { revalidatePath } from 'next/cache';

async function notifyAssignee(opts: {
  claimId: number;
  assigneeId: string;
  actorId: string;
  column: ClaimColumn;
}) {
  const supabase = await createClient();
  const [{ data: assignee }, { data: claim }] = await Promise.all([
    supabase
      .from('profiles')
      .select('email, display_name')
      .eq('id', opts.assigneeId)
      .single(),
    supabase
      .from('claims')
      .select('remito_number, observations')
      .eq('id', opts.claimId)
      .single(),
  ]);
  if (!assignee || !claim) return;
  const { subject, html } = assignmentEmail({
    recipientName: assignee.display_name,
    claimId: opts.claimId,
    remitoNumber: claim.remito_number,
    observations: claim.observations,
    column: opts.column,
    appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  });
  const res = await sendEmail({ to: assignee.email, subject, html });
  await supabase.from('claim_events').insert({
    claim_id: opts.claimId,
    actor_id: opts.actorId,
    event_type: res.ok ? 'email_sent' : 'email_failed',
    metadata: { email_to: assignee.email, error: res.ok ? null : res.error },
  });
}

export async function moveClaim(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const parsed = MoveClaimSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Input inválido' };
  const { claimId, toColumn, newAssigneeId } = parsed.data;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'No autenticado' };

  const { data: current, error: fetchErr } = await supabase
    .from('claims')
    .select('current_column, assignee_id')
    .eq('id', claimId)
    .single();
  if (fetchErr || !current) return { ok: false, error: 'Reclamo no encontrado' };

  const { error: updErr } = await supabase
    .from('claims')
    .update({ current_column: toColumn, assignee_id: newAssigneeId })
    .eq('id', claimId);
  if (updErr) return { ok: false, error: 'Sin permisos o error al mover' };

  await supabase.from('claim_events').insert({
    claim_id: claimId,
    actor_id: user.id,
    event_type: 'moved',
    from_column: current.current_column,
    to_column: toColumn,
    metadata: { new_assignee_id: newAssigneeId },
  });

  await notifyAssignee({
    claimId,
    assigneeId: newAssigneeId,
    actorId: user.id,
    column: toColumn as ClaimColumn,
  });

  revalidatePath('/board');
  return { ok: true };
}

export async function createClaim(
  input: unknown,
): Promise<{ ok: boolean; error?: string; claimId?: number }> {
  const parsed = CreateClaimSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Input inválido' };
  const {
    remitoNumber,
    observations,
    claimType,
    assigneeId,
    invoiceNumber,
    clientName,
    fantasyName,
    videoArmadoReviewed,
    videoClienteReviewed,
  } = parsed.data;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'No autenticado' };

  let effectiveAssigneeId = assigneeId ?? null;
  if (!effectiveAssigneeId) {
    const { data: def } = await supabase
      .from('column_defaults')
      .select('default_assignee_id')
      .eq('column_key', 'nuevo')
      .maybeSingle();
    effectiveAssigneeId = def?.default_assignee_id ?? null;
  }
  if (!effectiveAssigneeId) {
    return {
      ok: false,
      error: 'No hay responsable asignado a la columna "Nuevo". Configuralo en el botón "Responsables".',
    };
  }

  const { data: claim, error } = await supabase
    .from('claims')
    .insert({
      remito_number: remitoNumber,
      observations,
      current_column: 'nuevo',
      assignee_id: effectiveAssigneeId,
      created_by: user.id,
      invoice_number: invoiceNumber || null,
      client_name: clientName || null,
      fantasy_name: fantasyName || null,
      video_armado_reviewed: videoArmadoReviewed ?? false,
      video_cliente_reviewed: videoClienteReviewed ?? false,
      claim_type: claimType,
    })
    .select()
    .single();
  if (error || !claim) return { ok: false, error: 'Error al crear' };

  await supabase.from('claim_events').insert({
    claim_id: claim.id,
    actor_id: user.id,
    event_type: 'created',
    to_column: 'nuevo',
  });

  await notifyAssignee({
    claimId: claim.id,
    assigneeId: effectiveAssigneeId,
    actorId: user.id,
    column: 'nuevo',
  });

  revalidatePath('/board');
  return { ok: true, claimId: claim.id };
}

export async function addComment(input: {
  claimId: number;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const text = String(input.text ?? '').trim();
  if (!text) return { ok: false, error: 'Vacío' };
  if (text.length > 2000) return { ok: false, error: 'Muy largo' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'No autenticado' };

  const { error } = await supabase.from('claim_events').insert({
    claim_id: Number(input.claimId),
    actor_id: user.id,
    event_type: 'commented',
    comment_text: text,
  });
  if (error) return { ok: false, error: 'Error al comentar' };
  revalidatePath('/board');
  return { ok: true };
}

export async function setColumnDefaults(input: {
  defaults: { columnKey: string; assigneeId: string | null }[];
}): Promise<{ ok: boolean; error?: string }> {
  if (!Array.isArray(input.defaults)) return { ok: false, error: 'Input inválido' };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'No autenticado' };

  for (const d of input.defaults) {
    if (d.assigneeId) {
      const { error } = await supabase
        .from('column_defaults')
        .upsert({ column_key: d.columnKey, default_assignee_id: d.assigneeId })
        .eq('column_key', d.columnKey);
      if (error) return { ok: false, error: 'Sin permisos o error al guardar' };
    } else {
      await supabase.from('column_defaults').delete().eq('column_key', d.columnKey);
    }
  }
  revalidatePath('/board');
  return { ok: true };
}

export async function deleteClaim(input: {
  claimId: number;
}): Promise<{ ok: boolean; error?: string }> {
  const claimId = Number(input.claimId);
  if (!Number.isInteger(claimId) || claimId <= 0) {
    return { ok: false, error: 'ID inválido' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'No autenticado' };

  // Best-effort: borrar archivos del bucket antes del delete del claim
  // (RLS del claim + cascade borran attachments row + claim_events row).
  const { data: atts } = await supabase
    .from('attachments')
    .select('storage_path')
    .eq('claim_id', claimId);
  if (atts && atts.length > 0) {
    const paths = atts.map((a) => a.storage_path);
    await supabase.storage.from('claim-attachments').remove(paths);
  }

  const { error } = await supabase.from('claims').delete().eq('id', claimId);
  if (error) return { ok: false, error: 'Sin permisos o error al eliminar' };

  revalidatePath('/board');
  return { ok: true };
}

export async function toggleVideoReviewed(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = ToggleVideoReviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Input inválido' };
  const { claimId, field, value } = parsed.data;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'No autenticado' };

  const patch =
    field === 'armado'
      ? { video_armado_reviewed: value }
      : { video_cliente_reviewed: value };

  const { error } = await supabase
    .from('claims')
    .update(patch)
    .eq('id', claimId);
  if (error) {
    return {
      ok: false,
      error: `No se pudo actualizar (${error.code ?? 'unknown'}): ${error.message}`,
    };
  }

  await supabase.from('claim_events').insert({
    claim_id: claimId,
    actor_id: user.id,
    event_type: 'video_reviewed',
    metadata: { field, value },
  });

  revalidatePath('/board');
  return { ok: true };
}

export async function uploadAttachmentMetadata(input: {
  claimId: number;
  storagePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}): Promise<{ ok: boolean; error?: string; attachmentId?: number }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'No autenticado' };

  const { data: att, error } = await supabase
    .from('attachments')
    .insert({
      claim_id: input.claimId,
      storage_path: input.storagePath,
      file_name: input.fileName,
      file_size: input.fileSize,
      mime_type: input.mimeType,
      uploaded_by: user.id,
    })
    .select()
    .single();
  if (error || !att) return { ok: false, error: 'Error registrando adjunto' };

  await supabase.from('claim_events').insert({
    claim_id: input.claimId,
    actor_id: user.id,
    event_type: 'attached',
    metadata: { attachment_id: att.id, file_name: input.fileName },
  });
  revalidatePath('/board');
  return { ok: true, attachmentId: att.id };
}

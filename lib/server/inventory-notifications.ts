import { createAdminClient } from '@/lib/supabase/admin';
import { getUsersWithModuleAccess } from '@/lib/server/team-permissions';

type AdminClient = ReturnType<typeof createAdminClient>;

interface InventoryLocationRequestNotificationInput {
  requestId: string;
  suggestedName: string;
  note: string | null;
  requesterId: string;
}

interface RecipientProfileRow {
  id: string;
  super_admin: boolean | null;
  role: {
    role_class: 'admin' | 'manager' | 'employee' | null;
    is_manager_admin: boolean | null;
    is_super_admin: boolean | null;
  } | null;
}

async function resolveInventoryManagerRecipientIds(admin: AdminClient): Promise<string[]> {
  const inventoryUserIds = Array.from(await getUsersWithModuleAccess('inventory', undefined, admin));
  if (inventoryUserIds.length === 0) return [];

  const { data, error } = await admin
    .from('profiles')
    .select(`
      id,
      super_admin,
      role:roles(
        role_class,
        is_manager_admin,
        is_super_admin
      )
    `)
    .in('id', inventoryUserIds);

  if (error) {
    throw new Error(error.message || 'Failed to resolve inventory notification recipients');
  }

  return ((data || []) as unknown as RecipientProfileRow[])
    .filter((profile) => {
      const role = profile.role;
      return (
        profile.super_admin === true ||
        role?.is_super_admin === true ||
        role?.role_class === 'admin' ||
        role?.is_manager_admin === true
      );
    })
    .map((profile) => profile.id);
}

export async function createInventoryLocationRequestNotification(
  admin: AdminClient,
  input: InventoryLocationRequestNotificationInput
): Promise<string[]> {
  const recipientIds = (await resolveInventoryManagerRecipientIds(admin))
    .filter((recipientId) => recipientId !== input.requesterId);

  if (recipientIds.length === 0) return [];

  const bodyLines = [
    'An employee requested a new inventory location.',
    '',
    `Suggested location: ${input.suggestedName}`,
  ];

  if (input.note) {
    bodyLines.push(`Note: ${input.note}`);
  }

  const { data: message, error: messageError } = await admin
    .from('messages')
    .insert({
      type: 'NOTIFICATION',
      subject: `Inventory location request: ${input.suggestedName}`,
      body: bodyLines.join('\n'),
      priority: 'LOW',
      sender_id: input.requesterId,
      created_via: 'inventory_location_request',
    })
    .select('id')
    .single();

  if (messageError || !message?.id) {
    throw new Error(messageError?.message || 'Failed to create inventory location request notification');
  }

  const { error: recipientsError } = await admin
    .from('message_recipients')
    .insert(
      recipientIds.map((recipientId) => ({
        message_id: message.id,
        user_id: recipientId,
        status: 'PENDING' as const,
      }))
    );

  if (recipientsError) {
    throw new Error(recipientsError.message || 'Failed to assign inventory location request notification');
  }

  return recipientIds;
}

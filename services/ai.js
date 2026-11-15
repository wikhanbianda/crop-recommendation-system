// Asisten AI: hanya lewat /.netlify/functions/ai-chat. Riwayat dibaca lewat RLS (hanya milik sendiri).
import { fn } from './api.js';
import { from } from './supabase.js';

export const status = () => fn('ai-chat');
export const send = (message, { conversation_id, exam_id } = {}) => fn('ai-chat', { method: 'POST', body: { message, ...(conversation_id ? { conversation_id } : {}), ...(exam_id ? { exam_id } : {}) } });
export const ping = () => fn('ai-chat', { method: 'POST', body: { action: 'ping' } });
export const conversations = async () => (await from('ai_conversations').select('id,title,updated_at').order('updated_at', false).limit(50).run()).data;
export const messages = async (id) => (await from('ai_messages').select('id,role,content,created_at').eq('conversation_id', id).order('created_at', true).limit(200).run()).data;
export const removeConversation = (id) => from('ai_conversations').eq('id', id).remove().run();

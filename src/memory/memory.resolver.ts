import { Resolver, Tool } from '@nestjs-mcp/server';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { MemoryService } from './memory.service';

const memoryTypeSchema = z.enum(['fact', 'episode_summary']);

function formatSaveMemoryResult(status: string) {
  if (status === 'inserted') return '<b>✅ Memory baru berhasil disimpan.</b>';
  if (status === 'updated') return '<b>♻️ Memory lama berhasil diperbarui.</b>';
  if (status === 'refreshed') return '<b>ℹ️ Memory yang sama sudah ada, metadata-nya diperbarui.</b>';
  return '<b>ℹ️ Tidak ada memory baru yang disimpan.</b>';
}

@Resolver('memory')
export class MemoryResolver {
  private readonly logger = new Logger(MemoryResolver.name);

  constructor(private readonly memoryService: MemoryService) {}

  @Tool({
    name: 'search_memory',
    description: 'Cari profil, preferensi, goal, pola rutin, atau ringkasan konteks lama user. Prioritaskan ini untuk jawaban yang relevan dan personal.',
    paramsSchema: {
      chatId: z.string().describe('ID chat user yang saat ini sedang aktif. WAJIB ADA.'),
      query: z.string().describe('Topik/pertanyaan untuk dicari di database memori.'),
    },
  })
  async searchMemory({ chatId, query }: { chatId: string; query: string }) {
    this.logger.log(`Tool search_memory dipanggil untuk: "${query}"`);
    const results = await this.memoryService.searchLongTermMemory(chatId, query);

    if (!results || results.length === 0) {
      return {
        content: [{ type: 'text', text: '<b>ℹ️ Tidak ada memori relevan yang ditemukan.</b>' }],
      };
    }

    const text = results
      .map(
        (result, index) =>
          `${index + 1}. [${result.memoryType.toUpperCase()} | ${result.category}] ${result.content}\n` +
          `   relevansi: ${(1 - result.distance).toFixed(2)} | penting: ${result.importanceScore.toFixed(2)} | muncul: ${result.mentionCount}x | update: ${new Date(result.lastConfirmedAt).toISOString().split('T')[0]}`,
      )
      .join('\n');

    return {
      content: [{ type: 'text', text: `<b>HASIL MEMORI</b>\n${text}` }],
    };
  }

  @Tool({
    name: 'save_memory',
    description: 'Simpan memory secara terstruktur. Tool ini idealnya dipanggil oleh pipeline sistem, bukan keputusan agent bebas.',
    paramsSchema: {
      chatId: z.string().describe('ID chat user yang saat ini sedang aktif'),
      content: z.string().trim().min(1).optional().describe('Konten memory yang akan disimpan'),
      fact: z.string().trim().min(1).optional().describe('Alias lama untuk content, dipertahankan demi kompatibilitas'),
      memoryType: memoryTypeSchema.optional().default('fact').describe('Jenis memory: fact atau episode_summary'),
      category: z.string().trim().min(1).optional().default('general').describe('Kategori memory, misalnya profile, preference, financial_goal, recurring_pattern, constraint, episode'),
      canonicalKey: z.string().trim().min(1).optional().describe('Kunci canonical untuk fact memory, misalnya recurring_pattern.salary_date'),
      importanceScore: z.number().min(0).max(1).optional().describe('Skor kepentingan 0..1'),
      confidence: z.number().min(0).max(1).optional().describe('Skor keyakinan 0..1'),
      sourceType: z.string().trim().min(1).optional().describe('Asal memory, misalnya system_checkpoint atau explicit_user'),
      expiresAt: z.string().datetime().optional().describe('Waktu kedaluwarsa untuk memory sementara seperti episode_summary'),
    },
  })
  async saveMemory({
    chatId,
    content,
    fact,
    memoryType = 'fact',
    category = 'general',
    canonicalKey,
    importanceScore,
    confidence,
    sourceType,
    expiresAt,
  }: {
    chatId: string;
    content?: string;
    fact?: string;
    memoryType?: 'fact' | 'episode_summary';
    category?: string;
    canonicalKey?: string;
    importanceScore?: number;
    confidence?: number;
    sourceType?: string;
    expiresAt?: string;
  }) {
    const payload = content ?? fact;
    this.logger.log(`Tool save_memory dipanggil untuk memory: "${payload}"`);

    if (!payload) {
      return {
        content: [{ type: 'text', text: '<b>❌ Content memory tidak boleh kosong.</b>' }],
        isError: true,
      };
    }

    const saved = await this.memoryService.saveToLongTermMemory({
      chatId,
      content: payload,
      memoryType,
      category,
      canonicalKey,
      importanceScore,
      confidence,
      sourceType,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    return {
      content: [
        {
          type: 'text',
          text: `${formatSaveMemoryResult(saved.status)}\n<b>Tipe:</b> ${memoryType}\n<b>Kategori:</b> ${category}`,
        },
      ],
    };
  }
}

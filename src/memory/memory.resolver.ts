import { Resolver, Tool } from '@nestjs-mcp/server';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { MemoryService } from './memory.service';

@Resolver('memory')
export class MemoryResolver {
  private readonly logger = new Logger(MemoryResolver.name);

  constructor(private readonly memoryService: MemoryService) {}

  @Tool({
    name: 'search_memory',
    description: "CARI riwayat, profil, preferensi, atau informasi apa pun yang pernah dibahas bersama user. PRIORITASKAN menggunakan ini untuk memberikan jawaban yang relevan dan personal.",
    paramsSchema: {
      chatId: z.string().describe("ID chat user yang saat ini sedang aktif. WAJIB ADA."),
      query: z.string().describe("Topik/pertanyaan untuk dicari di database memori."),
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
          `${index + 1}. ${result.content}\n   relevansi: ${(1 - result.distance).toFixed(2)} | disimpan: ${new Date(result.createdAt).toISOString().split('T')[0]}`,
      )
      .join('\n');

    return {
      content: [{ type: 'text', text: `<b>HASIL MEMORI</b>\n${text}` }],
    };
  }

  @Tool({
    name: 'save_memory',
    description: "Simpan FAKTA UNIK atau PREFERENSI user ke memori. JANGAN gunakan untuk menyimpan data transaksi seperti belanja, merchant, atau item. GUNAKAN untuk: profil, nama teman/keluarga, kebiasaan, tujuan, dan sentimen.",
    paramsSchema: {
      chatId: z.string().describe("ID chat user yang saat ini sedang aktif"),
      fact: z.string().describe("Fakta singkat dan padat yang ingin disimpan ke memori dalam bahasa indonesia, misal: 'Nopal itu teman dekat' atau 'User suka ngopi tiap pagi'"),
    },
  })
  async saveMemory({ chatId, fact }: { chatId: string; fact: string }) {
    this.logger.log(`Tool save_memory dipanggil untuk fakta: "${fact}"`);
    const saved = await this.memoryService.saveToLongTermMemory(chatId, fact);
    
    return {
      content: [{ type: 'text', text: saved ? '<b>✅ Fakta berhasil disimpan ke memori jangka panjang.</b>' : '<b>ℹ️ Fakta yang sama sudah pernah disimpan.</b>' }],
    };
  }
}

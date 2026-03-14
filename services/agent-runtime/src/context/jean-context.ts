import type { FileService } from "@jeanbot/file-service";

export class JeanContextLoader {
  constructor(private readonly fileService: FileService) {}

  async load(jeanFilePath: string) {
    return this.fileService.readJeanFile(jeanFilePath);
  }
}

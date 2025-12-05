import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import {
  AppStateSingleton,
  config as appConfig,
  createError,
  errlog,
  exitOne,
  isEexistError,
  isEnoentError,
  isTypeError,
  log,
  red,
  runConcur,
  simpleTemplate,
} from "../core/index.ts";

let glob: typeof import("glob").glob;

export async function deleteProgressEntry(hash: string): Promise<string> {
  const appState = AppStateSingleton.getInstance();
  if (!hash) {
    throw createError(appState.s.e.lllm.emptyFile, {
      code: "EMPTY_HASH_PROVIDED",
    });
  }
  const fStatePath = path.join(appState.STATE_DIR, `${hash}.json`);

  try {
    await unlink(fStatePath);
    return simpleTemplate(appState.s.m.lllm.progressFileDeleted, {
      Hash: hash,
    });
  } catch (err) {
    if (isEnoentError(err)) {
      throw createError(
        simpleTemplate(appState.s.e.lllm.progressFileDoesNotExist, {
          Hash: hash,
        }),
        { cause: err },
      );
    }
    throw createError(
      appState.s.e.lcli.unknownErrorOccurred +
        appState.s.e.lllm.whileCalling_deleteProgressEntry,
      { cause: err },
    );
  }
}

export async function findAllProgressEntries(protectedFiles: string[]) {
  const appState = AppStateSingleton.getInstance();
  const files = await readdir(appState.STATE_DIR);

  const jsonFiles = files
    .filter((file) => path.extname(file) === ".json")
    .map((file) => path.join(appState.STATE_DIR, file))
    .filter((file) => !protectedFiles.includes(path.basename(file)));

  const tasks = jsonFiles.map((file, i) => async () => {
    const raw = await readFile(file, "utf-8");
    const data = JSON.parse(raw) as { fileName?: string };
    return `[${i + 1}]${data.fileName ?? ""} ${path.basename(file)}`;
  });

  const formattedFileNamesList = await runConcur(tasks, { concurrency: 64 });

  return [formattedFileNamesList, jsonFiles] as const;
}

export async function validateFiles(sourcePath?: string, targetPath?: string) {
  const appState = AppStateSingleton.getInstance();

  if (!sourcePath && !targetPath) return;

  if (sourcePath) {
    try {
      // It serves as both the existence check and size check.
      const stats = await stat(sourcePath);

      if (stats.size / (1024 * 1024) > appConfig.MAX_SIZE_MB) {
        throw createError(
          simpleTemplate(appState.s.e.lllm.invalidFileSize, {
            MAX_SIZE_MB: appConfig.MAX_SIZE_MB,
          }),
          { code: "FILE_TOO_LARGE" },
        );
      }
    } catch (err) {
      if (isEnoentError(err)) {
        throw createError(
          simpleTemplate(appState.s.e.lllm.fileNotFound, {
            FilePath: sourcePath,
          }),
          { code: "ENOENT", cause: err },
        );
      }
      throw err;
    }
  }

  if (sourcePath && targetPath && sourcePath === targetPath) {
    throw createError(appState.s.e.lllm.sourceAndTargetMustBeDifferent, {
      code: "SOURCE_TARGET_SAME",
    });
  }
}

export async function findFilesRecursively(
  sourcePath: string,
  extension: string,
): Promise<{ filePath: string; fileSize: number }[]> {
  const results: { filePath: string; fileSize: number }[] = [];
  const ext = `.${extension}`;

  async function walk(dir: string) {
    const files = await readdir(dir, { withFileTypes: true });
    for (const file of files) {
      const resPath = path.join(dir, file.name);
      if (file.isDirectory()) {
        await walk(resPath);
      } else if (file.isFile() && file.name.endsWith(ext)) {
        const stats = await stat(resPath);
        results.push({ filePath: resPath, fileSize: stats.size });
      }
    }
  }
  await walk(sourcePath);
  return results;
}

export async function splitFile(
  sourcePath: string,
  targetPath: string,
  size = 1,
): Promise<string[]> {
  const appState = AppStateSingleton.getInstance();
  await validateFiles(sourcePath);

  const sourceStats = await stat(sourcePath);
  const maxBytes = size * 1024 * 1024;

  if (sourceStats.size <= maxBytes) {
    return [sourcePath];
  }

  try {
    await stat(targetPath);
    throw createError(
      red(
        simpleTemplate(appState.s.e.lllm.targetFileExists, {
          TargetPath: targetPath,
        }),
      ),
      { code: "TARGET_EXISTS" },
    );
  } catch (err) {
    if (isEnoentError(err)) {
      await mkdir(targetPath, { recursive: true });
    } else {
      throw err;
    }
  }

  const sourceExt = path.extname(sourcePath);
  const sourceBaseName = path.basename(sourcePath, sourceExt);

  const partPaths: string[] = [];
  let partNumber = 0;
  let currentWriter: import("fs").WriteStream | null = null;
  let currentPartSize = 0;

  const createNewPart = async () => {
    if (currentWriter) {
      await new Promise<void>((resolve) => currentWriter!.end(resolve));
    }
    partNumber++;
    const partPath = path.join(
      targetPath,
      `${sourceBaseName}_part${partNumber}${sourceExt}`,
    );
    partPaths.push(partPath);

    currentWriter = createWriteStream(partPath, { flags: "wx" });

    currentPartSize = 0;
  };

  await createNewPart();

  try {
    const decoder = new TextDecoder();
    let leftoverLine = "";

    const readStream = createReadStream(sourcePath);

    for await (const chunk of readStream) {
      const textChunk =
        leftoverLine + decoder.decode(chunk as Buffer, { stream: true });
      const lines = textChunk.split("\n");

      leftoverLine = lines.pop() ?? "";

      for (const line of lines) {
        const lineWithNewline = `${line}\n`;
        const lineSize = Buffer.byteLength(lineWithNewline, "utf8");

        if (currentPartSize > 0 && currentPartSize + lineSize > maxBytes) {
          await createNewPart();
        }

        currentWriter!.write(lineWithNewline);
        currentPartSize += lineSize;
      }
    }

    if (leftoverLine) {
      const lineSize = Buffer.byteLength(leftoverLine, "utf8");
      if (currentPartSize > 0 && currentPartSize + lineSize > maxBytes) {
        await createNewPart();
      }
      currentWriter!.write(leftoverLine);
      currentPartSize += lineSize;
    }
  } catch (err) {
    if (isTypeError(err)) {
      throw err;
    }
    if (isEexistError(err)) {
      throw createError(
        red(
          simpleTemplate(appState.s.e.lllm.targetFileExists, {
            TargetPath: "Part file collision",
          }),
        ),
        { code: "TARGET_EXISTS" },
      );
    }

    throw createError(appState.s.e.lcli.unknownErrorOccurred, { cause: err });
  } finally {
    if (currentWriter) {
      await new Promise<void>((resolve) => currentWriter!.end(resolve));
    }
  }

  return partPaths;
}

export async function mergeFiles(
  sourcePath: string,
  targetPath: string,
  extension: string,
) {
  const appState = AppStateSingleton.getInstance();
  const mergedFileName = `${extension}_merged.txt`;
  const outputPath = path.join(targetPath, mergedFileName);

  const files = await findFilesRecursively(sourcePath, extension);

  if (files.length === 0) {
    errlog(
      red(
        simpleTemplate(appState.s.e.lllm.noFilesFound, {
          Extension: extension,
        }),
      ),
    );
    exitOne();
    return 1;
  }

  files.sort((a, b) =>
    a.filePath.localeCompare(b.filePath, undefined, { numeric: true }),
  );

  const totalSizeBytes = files.reduce((sum, file) => sum + file.fileSize, 0);
  if (totalSizeBytes > appConfig.MAX_SIZE_MB * (1 << 20)) {
    errlog(
      red(
        simpleTemplate(appState.s.e.lllm.invalidFileSize, {
          MAX_SIZE_MB: appConfig.MAX_SIZE_MB,
        }),
      ),
    );
    exitOne();
    return 1;
  }

  const writer = createWriteStream(outputPath, {
    highWaterMark: 4 * 1024 * 1024,
    flags: "wx",
  });

  try {
    await new Promise<void>((resolve, reject) => {
      writer.on("open", () => resolve());
      writer.on("error", reject);
    });
    for (const { filePath } of files) {
      const fileHeader =
        simpleTemplate(appState.s.m.lllm.content, {
          Filename: path.basename(filePath),
        }) + "\n\n";

      writer.write(fileHeader);

      const readStream = createReadStream(filePath);
      for await (const chunk of readStream) {
        writer.write(chunk);
      }
    }

    await new Promise<void>((resolve) => writer.end(resolve));
    log(
      simpleTemplate(appState.s.m.lllm.filesMerged, {
        MergedFileName: mergedFileName,
      }),
    );
  } catch (err) {
    writer.destroy();
    if (isEexistError(err)) {
      throw createError(
        red(
          simpleTemplate(appState.s.e.lllm.targetFileExists, {
            TargetPath: outputPath,
          }),
        ),
        { code: "TARGET_EXISTS" },
      );
    }

    await unlink(outputPath).catch(() => {});
    if (isTypeError(err)) {
      throw err;
    }
    throw createError(appState.s.e.lcli.unknownErrorOccurred, { cause: err });
  }
  return 0;
}

export async function buildImageContent(
  imageArg: string | undefined | null,
): Promise<string[]> {
  const appState = AppStateSingleton.getInstance();
  if (!imageArg) {
    return [];
  }

  if (!glob) {
    glob = (await import("glob")).glob;
  }

  const imageURIs: string[] = [];
  const patterns = imageArg.split(/:(?![\\/])/).map((p) => p.trim());

  for (const pattern of patterns) {
    const matches = await glob(pattern, { nodir: true });

    for (const p of matches) {
      const ext = path.extname(p).toLowerCase();
      let mime: string | undefined;

      switch (ext) {
        case ".png":
          mime = "image/png";
          break;
        case ".jpg":
        case ".jpeg":
          mime = "image/jpeg";
          break;
        case ".gif":
          mime = "image/gif";
          break;
        case ".webp":
          mime = "image/webp";
          break;
        default:
          log(
            red(
              simpleTemplate(appState.s.e.v.unsupportedImageType2, {
                Ext: ext,
                Image: p,
              }),
            ),
          );
          continue;
      }

      try {
        const stats = await stat(p);
        if (stats.size / (1024 * 1024) > appConfig.MAX_SIZE_MB) {
          throw createError(
            simpleTemplate(appState.s.e.lllm.invalidFileSize, {
              MAX_SIZE_MB: appConfig.MAX_SIZE_MB,
            }),
            { code: "FILE_TOO_LARGE" },
          );
        }

        const buffer = await readFile(p);
        imageURIs.push(`data:${mime};base64,${buffer.toString("base64")}`);
      } catch (err) {
        if (isEnoentError(err)) {
          log(red(simpleTemplate(appState.s.e.v.imageNotFound, { Image: p })));
        } else {
          throw err;
        }
        continue;
      }
    }
  }

  if (patterns.length > 0 && imageURIs.length === 0) {
    log(
      red(
        simpleTemplate(appState.s.e.v.unsupportedImageType, { Args: imageArg }),
      ),
    );
  }

  return [...new Set(imageURIs)];
}

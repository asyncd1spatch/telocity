import { type FileSink, Glob } from "bun";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import {
  AppStateSingleton,
  config as appConfig,
  createError,
  errlog,
  exitOne,
  isEnoentError,
  isTypeError,
  log,
  red,
  runConcur,
  simpleTemplate,
} from "../core";

export async function deleteProgressEntry(hash: string): Promise<string> {
  const appState = AppStateSingleton.getInstance();
  if (!hash) {
    throw createError(appState.s.e.lllm.emptyFile, { code: "EMPTY_HASH_PROVIDED" });
  }
  const fStatePath = path.join(appState.STATE_DIR, `${hash}.json`);

  try {
    const file = Bun.file(fStatePath);
    if (!(await file.exists())) {
      throw createError(
        simpleTemplate(appState.s.e.lllm.progressFileDoesNotExist, { Hash: hash }),
        { code: "ENOENT" },
      );
    }
    await file.delete();
    return simpleTemplate(appState.s.m.lllm.progressFileDeleted, { Hash: hash });
  } catch (err) {
    if (isEnoentError(err)) {
      throw createError(
        simpleTemplate(appState.s.e.lllm.progressFileDoesNotExist, { Hash: hash }),
        { cause: err },
      );
    }
    throw createError(
      appState.s.e.lcli.unknownErrorOccurred
        + appState.s.e.lllm.whileCalling_deleteProgressEntry,
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
    const raw = await Bun.file(file).text();
    const data = JSON.parse(raw) as { fileName?: string };
    return `[${i + 1}]${data.fileName ?? ""} ${path.basename(file)}`;
  });

  const formattedFileNamesList = await runConcur(tasks, { concurrency: 64 });

  return [formattedFileNamesList, jsonFiles] as const;
}

export async function validateFiles(sourcePath: string, targetPath = "") {
  const appState = AppStateSingleton.getInstance();
  const sourceFile = Bun.file(sourcePath);

  if (!(await sourceFile.exists())) {
    throw createError(
      simpleTemplate(appState.s.e.lllm.fileNotFound, { FilePath: sourcePath }),
      { code: "ENOENT" },
    );
  }

  if (sourceFile.size / (1024 * 1024) > appConfig.MAX_SIZE_MB) {
    throw createError(
      simpleTemplate(appState.s.e.lllm.invalidFileSize, {
        MAX_SIZE_MB: appConfig.MAX_SIZE_MB,
      }),
      { code: "FILE_TOO_LARGE" },
    );
  }

  if (targetPath) {
    if (sourcePath === targetPath) {
      throw createError(appState.s.e.lllm.sourceAndTargetMustBeDifferent, {
        code: "SOURCE_TARGET_SAME",
      });
    }
  }
}

export async function findFilesRecursively(
  sourcePath: string,
  extension: string,
): Promise<{ filePath: string; fileSize: number }[]> {
  const results: { filePath: string; fileSize: number }[] = [];
  const ext = `.${extension}`;

  const relFiles = await readdir(sourcePath, { recursive: true });

  for (const relPath of relFiles) {
    if (relPath.endsWith(ext)) {
      const fullPath = path.join(sourcePath, relPath);
      const file = Bun.file(fullPath);
      results.push({ filePath: fullPath, fileSize: file.size });
    }
  }

  return results;
}

export async function splitFile(
  sourcePath: string,
  targetPath: string,
  size = 1,
): Promise<string[]> {
  const appState = AppStateSingleton.getInstance();
  if (await Bun.file(targetPath).exists()) {
    const appState = AppStateSingleton.getInstance();
    throw createError(
      red(simpleTemplate(appState.s.e.lllm.targetFileExists, { TargetPath: targetPath })),
      { code: "TARGET_EXISTS" },
    );
  }

  const sourceFile = Bun.file(sourcePath);
  const maxBytes = size * 1024 * 1024;

  if (sourceFile.size <= maxBytes) {
    return [sourcePath];
  }

  await mkdir(targetPath, { recursive: true });

  const sourceExt = path.extname(sourcePath);
  const sourceBaseName = path.basename(sourcePath, sourceExt);

  const partPaths: string[] = [];
  let partNumber = 0;
  let currentWriter: FileSink | null = null;
  let currentPartSize = 0;

  const createNewPart = async () => {
    if (currentWriter) {
      await currentWriter.end();
    }
    partNumber++;
    const partPath = path.join(
      targetPath,
      `${sourceBaseName}_part${partNumber}${sourceExt}`,
    );
    partPaths.push(partPath);
    currentWriter = Bun.file(partPath).writer();
    currentPartSize = 0;
  };

  await createNewPart();

  try {
    const decoder = new TextDecoder();
    let leftoverLine = "";

    for await (const chunk of sourceFile.stream()) {
      const textChunk = leftoverLine + decoder.decode(chunk, { stream: true });
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
    throw createError(appState.s.e.lcli.unknownErrorOccurred, { cause: err });
  } finally {
    if (currentWriter) {
      await currentWriter.end();
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

  if (await Bun.file(outputPath).exists()) {
    throw createError(
      red(simpleTemplate(appState.s.e.lllm.targetFileExists, { TargetPath: outputPath })),
      { code: "TARGET_EXISTS" },
    );
  }

  const files = await findFilesRecursively(sourcePath, extension);

  if (files.length === 0) {
    errlog(red(simpleTemplate(appState.s.e.lllm.noFilesFound, { Extension: extension })));
    exitOne();
    return 1;
  }

  files.sort((a, b) => a.filePath.localeCompare(b.filePath));

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

  const outputFile = Bun.file(outputPath);
  const writer = outputFile.writer({ highWaterMark: 4 * 1024 * 1024 });

  try {
    for (const { filePath } of files) {
      const fileHeader = simpleTemplate(appState.s.m.lllm.content, {
        Filename: path.basename(filePath),
      }) + "\n\n";

      writer.write(fileHeader);

      const inputFile = Bun.file(filePath);
      for await (const chunk of inputFile.stream()) {
        writer.write(chunk);
      }
    }

    await writer.end();
    log(
      simpleTemplate(appState.s.m.lllm.filesMerged, { MergedFileName: mergedFileName }),
    );
  } catch (err) {
    await outputFile.delete().catch(() => {});
    if (isTypeError(err)) {
      throw err;
    }
    throw createError(appState.s.e.lcli.unknownErrorOccurred, { cause: err });
  }
  return 0;
}

export async function buildImageContent(imageArg: string | undefined | null): Promise<string[]> {
  const appState = AppStateSingleton.getInstance();
  if (!imageArg) {
    return [];
  }

  const imageURIs: string[] = [];
  const patterns = imageArg.split(",").map((p) => p.trim());

  for (const pattern of patterns) {
    const glob = new Glob(pattern);
    for await (const p of glob.scan(".")) {
      const file = Bun.file(p);
      if (!(await file.exists())) {
        log(red(simpleTemplate(appState.s.e.v.imageNotFound, { Image: p })));
        continue;
      }

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
          log(red(simpleTemplate(appState.s.e.v.unsupportedImageType2, { Ext: ext, Image: p })));
          continue;
      }

      const buffer = await file.arrayBuffer();
      imageURIs.push(`data:${mime};base64,${Buffer.from(buffer).toString("base64")}`);
    }
  }

  if (patterns.length > 0 && imageURIs.length === 0) {
    log(red(simpleTemplate(appState.s.e.v.unsupportedImageType, { Args: imageArg })));
  }

  return [...new Set(imageURIs)];
}

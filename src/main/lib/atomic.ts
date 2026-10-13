import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, rmSync } from 'fs'
import { dirname } from 'path'

/** 同目录临时文件写入并同步成功后替换原文件；失败时保留旧内容。 */
export function atomicWrite(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  let fd: number | undefined
  try {
    fd = openSync(temporary, 'wx')
    writeFileSync(fd, content, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(temporary, file)
  } finally {
    if (fd !== undefined) closeSync(fd)
    rmSync(temporary, { force: true })
  }
}

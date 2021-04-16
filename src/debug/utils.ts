import * as path from 'path'
import { logger } from 'vscode-debugadapter'

export function findPathSeparator(filePath: string) {
  return filePath.includes('/') ? '/' : '\\'
}

export function fixDriveCasingInWindows(pathToFix: string): string {
  return process.platform === 'win32' && pathToFix
    ? pathToFix.substr(0, 1).toUpperCase() + pathToFix.substr(1)
    : pathToFix
}

export function normalizePath(filePath: string) {
  if (process.platform === 'win32') {
    const pathSeparator = findPathSeparator(filePath)
    filePath = path.normalize(filePath)
    // Normalize will replace everything with backslash on Windows.
    filePath = filePath.replace(/\\/g, pathSeparator)
    return fixDriveCasingInWindows(filePath)
  }
  return filePath
}

export function random(low: number, high: number): number {
  return Math.floor(Math.random() * (high - low) + low)
}

export function log(...args: any[]) {
  logger.warn(logArgsToString(args))
}

export function logError(...args: any[]) {
  logger.error(logArgsToString(args))
}

export function logArgsToString(args: any[]): string {
  return args
    .map(arg => {
      return typeof arg === 'string' ? arg : JSON.stringify(arg)
    })
    .join(' ')
}

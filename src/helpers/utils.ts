import fs from 'fs';

export function pick<T extends object, K extends keyof T> (base: T, keys: K[]): Pick<T, K> {
  const entries = keys
    .filter(key => !!base[key])
    .map(key => ([key, base[key]]));

  return Object.fromEntries(entries);
}

export function *getCommandFileNames (folderPath: string) {
  for (const commandsFolder of fs.readdirSync(folderPath, { withFileTypes: true })) {
    if (commandsFolder.isDirectory()) {
      const commandsFolderPath = `${folderPath}/${commandsFolder.name}`;
      for (const commandFile of fs.readdirSync(commandsFolderPath, { withFileTypes: true })) {
        // Yield file if it is a javascript file not starting with an underscore
        if (commandFile.isFile() && commandFile.name.match(/^[^_].*\.js$/)) {
          yield `${commandsFolderPath}/${commandFile.name}`;
        }
      }
    }
  }
}

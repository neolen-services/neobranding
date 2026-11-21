// Data folder types, shared by the main process and the UI.

export type DataFolderInfo = {
  /** The folder holding all of the user's data. */
  path: string;
  defaultPath: string;
  isDefault: boolean;
};

export type DataFolderResult =
  | {
      ok: true;
      info: DataFolderInfo;
      /** True if the chosen folder already held app data, which is now in use. */
      usedExisting: boolean;
    }
  | { ok: false; error: string };

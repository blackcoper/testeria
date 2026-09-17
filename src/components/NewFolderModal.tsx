import React, { useState } from 'react';
import { FolderPlus, X } from 'lucide-react';

interface NewFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (folderPath: string) => void;
  defaultParent?: string;
}

export const NewFolderModal: React.FC<NewFolderModalProps> = ({
  isOpen,
  onClose,
  onCreate,
  defaultParent = ''
}) => {
  const [folderName, setFolderName] = useState('');
  const [parentPath, setParentPath] = useState(defaultParent || '/');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderName.trim()) return;

    const cleanParent = parentPath.replace(/^\/+|\/+$/g, '');
    const cleanName = folderName.trim().replace(/^\/+|\/+$/g, '');
    const fullPath = cleanParent ? `/${cleanParent}/${cleanName}` : `/${cleanName}`;

    onCreate(fullPath);
    setFolderName('');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
          <div className="flex items-center gap-2 font-semibold text-sm text-zinc-100">
            <FolderPlus className="w-4 h-4 text-amber-400" />
            <span>Create New Folder / Group</span>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Parent Directory / Path</label>
            <input
              type="text"
              value={parentPath}
              onChange={e => setParentPath(e.target.value)}
              placeholder="e.g. /Auth Module or /"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Folder Name (e.g. Feature B or Negative Cases)</label>
            <input
              type="text"
              value={folderName}
              onChange={e => setFolderName(e.target.value)}
              placeholder="e.g. Feature B"
              autoFocus
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="text-[11px] text-zinc-500 font-mono pt-1">
            Resulting Path: <span className="text-amber-400">
              {parentPath.replace(/^\/+|\/+$/g, '') ? `/${parentPath.replace(/^\/+|\/+$/g, '')}/${folderName || '...'}` : `/${folderName || '...'}`}
            </span>
          </div>

          <div className="flex items-center justify-end space-x-2 pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!folderName.trim()}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold disabled:opacity-50 transition-colors"
            >
              Create Folder
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

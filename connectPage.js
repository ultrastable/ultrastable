import React from 'react';

const ConnectPage = () => {
  const handleAddToVSCode = () => {
    // implementation to add to VS Code
  };
  const handleAddToClaude = () => {
    // implementation to add to Claude
  };
  const handleAddToCodex = () => {
    // implementation to add to Codex
  };
  const handleAddToCursor = () => {
    // implementation to add to Cursor
  };

  return (
    <div>
      <button onClick={handleAddToVSCode}>Add to VS Code</button>
      <button onClick={handleAddToClaude}>Add to Claude</button>
      <button onClick={handleAddToCodex}>Add to Codex</button>
      <button onClick={handleAddToCursor}>Add to Cursor</button>
    </div>
  );
};

export default ConnectPage;

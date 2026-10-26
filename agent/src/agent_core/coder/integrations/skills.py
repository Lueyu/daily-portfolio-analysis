"""Read-only skill catalog with bounded files and no symbolic-link escapes."""

from __future__ import annotations

import os
import re
from pathlib import Path


class SkillCatalog:
    def __init__(self, project_root: Path, configured_dir: str | None = None, forbidden_roots=()):
        self.roots = {"project": project_root.resolve() / ".agents" / "skills"}
        if configured_dir:
            self.roots["configured"] = Path(configured_dir).expanduser().resolve()
        self.forbidden_roots = [Path(root).resolve() for root in forbidden_roots]

    def discover(self) -> dict:
        skills, errors = [], []
        for source, root in self.roots.items():
            if any(root.resolve().is_relative_to(item) for item in self.forbidden_roots):
                errors.append({"source": source, "error": "Skill root is inside an editable task workspace"})
                continue
            if not root.is_dir():
                continue
            for parent, dirs, files in os.walk(root, followlinks=False):
                parent_path = Path(parent)
                depth = len(parent_path.relative_to(root).parts)
                dirs[:] = sorted(d for d in dirs if not (parent_path / d).is_symlink()) if depth < 6 else []
                if "SKILL.md" not in files:
                    continue
                path = parent_path / "SKILL.md"
                if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
                    continue
                if path.stat().st_size > 65536:
                    errors.append({"source": source, "error": f"Skill {parent_path.name} exceeds 64 KB"})
                    continue
                content = path.read_text(encoding="utf-8")
                relative = parent_path.relative_to(root).as_posix()
                name = re.search(r"^name:\s*(.+)$", content, re.MULTILINE)
                description = re.search(r"^description:\s*(.+)$", content, re.MULTILINE)
                skills.append({
                    "id": f"{source}/{relative}", "name": name.group(1).strip(" '\"") if name else parent_path.name,
                    "description": description.group(1).strip(" '\"")[:2000] if description else "",
                    "path": str(path), "source": source,
                })
                if len(skills) >= 512:
                    return {"ok": True, "skills": skills, "errors": errors, "truncated": True}
        return {"ok": not errors, "skills": skills, "errors": errors}

    def read(self, skill_id: str) -> dict:
        for item in self.discover()["skills"]:
            if item["id"] == skill_id:
                return {"ok": True, "skill": item, "content": Path(item["path"]).read_text(encoding="utf-8"),
                        "instructionPriority": "subordinate_to_system_and_user", "executesCode": False}
        return {"ok": False, "status": "not_found", "error": "Skill ID is not in the trusted catalog"}

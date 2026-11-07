//! Native git operations via libgit2 (more reliable than shell for branch/status).

use git2::{BranchType, ErrorCode, Repository};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoInfo {
    pub is_repo: bool,
    pub has_commits: bool,
    pub branch: String,
    pub branches: Vec<String>,
}

fn map_err(e: git2::Error) -> String {
    e.message().to_string()
}

fn open_repo(cwd: &str) -> Result<Option<Repository>, String> {
    match Repository::discover(cwd) {
        Ok(repo) => Ok(Some(repo)),
        Err(e) if e.code() == ErrorCode::NotFound => Ok(None),
        Err(e) => Err(map_err(e)),
    }
}

fn is_unborn(repo: &Repository) -> bool {
    matches!(repo.head().map_err(|e| e.code()), Err(ErrorCode::UnbornBranch))
}

pub fn repo_info(cwd: &str) -> Result<GitRepoInfo, String> {
    let Some(repo) = open_repo(cwd)? else {
        return Ok(GitRepoInfo {
            is_repo: false,
            has_commits: false,
            branch: String::new(),
            branches: vec![],
        });
    };

    let has_commits = !is_unborn(&repo) && repo.head().ok().and_then(|h| h.target()).is_some();

    let branch = match repo.head() {
        Ok(h) if h.is_branch() => h.shorthand().unwrap_or("HEAD").to_string(),
        Ok(_) => "HEAD".to_string(),
        Err(_) => repo
            .find_reference("HEAD")
            .ok()
            .and_then(|r| r.symbolic_target().map(|t| t.to_string()))
            .and_then(|t| t.strip_prefix("refs/heads/").map(|s| s.to_string()))
            .unwrap_or_else(|| "main".into()),
    };

    let mut branches = Vec::new();
    if let Ok(iter) = repo.branches(Some(BranchType::Local)) {
        for b in iter.flatten() {
            if let Some(name) = b.0.name().ok().flatten() {
                branches.push(name.to_string());
            }
        }
    }

    Ok(GitRepoInfo {
        is_repo: true,
        has_commits,
        branch,
        branches,
    })
}

/// Validate branch name (mirror of TS rules — reject commas etc.)
pub fn validate_branch_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Branch name cannot be empty".into());
    }
    if trimmed.contains(',') {
        return Err(format!(
            "Cannot create branch '{trimmed}' — comma not allowed, use hyphen"
        ));
    }
    if trimmed.contains(' ') {
        return Err("Spaces not allowed in branch names — use hyphens".into());
    }
    if trimmed.contains("..")
        || trimmed.contains('~')
        || trimmed.contains('^')
        || trimmed.contains(':')
        || trimmed.contains('?')
        || trimmed.contains('*')
        || trimmed.contains('[')
        || trimmed.contains('\\')
        || trimmed.contains("@{")
    {
        return Err(format!("Invalid branch name '{trimmed}'"));
    }
    Ok(())
}

pub fn create_branch(cwd: &str, name: &str, checkout: bool) -> Result<String, String> {
    validate_branch_name(name)?;
    let repo = open_repo(cwd)?.ok_or_else(|| "Not a git repository".to_string())?;

    if is_unborn(&repo) {
        return Err(
            "No commits yet — create an initial commit before creating a branch".into(),
        );
    }

    let head = repo.head().map_err(map_err)?;
    let commit = head.peel_to_commit().map_err(|_| {
        "No commits yet — create an initial commit before creating a branch".to_string()
    })?;

    let branch = repo.branch(name, &commit, false).map_err(map_err)?;

    if checkout {
        let full_ref = branch
            .get()
            .name()
            .ok_or_else(|| "Invalid branch ref".to_string())?
            .to_string();
        repo.set_head(&full_ref).map_err(map_err)?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
            .map_err(map_err)?;
        return Ok(format!("Switched to a new branch '{name}'"));
    }

    Ok(format!("Created branch '{name}'"))
}

pub fn has_commits(cwd: &str) -> Result<bool, String> {
    Ok(repo_info(cwd)?.has_commits)
}

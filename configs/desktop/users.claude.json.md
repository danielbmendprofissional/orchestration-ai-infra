# Somente a parte do mcpServers


  "mcpServers": {
    "figma": {
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "npx", "-y", "figma-developer-mcp", "--stdio"],
      "env": { "FIGMA_API_KEY": "${FIGMA_API_KEY}" }
    },
    "github": {
      "type": "stdio",
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "GITHUB_TOKEN", "ghcr.io/github/github-mcp-server"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    },
    "gitlab": {
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@zereight/mcp-gitlab"],
      "env": {
        "GITLAB_TOKEN": "${GITLAB_TOKEN}",
        "GITLAB_API_URL": "https://gitlab.com/api/v4"
      }
    }
  }
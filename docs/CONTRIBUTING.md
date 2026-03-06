# Contributing to Uptime Kuma Sync & Backup

## Development Workflow

We use a feature branch workflow with Pull Requests for all changes.

### Making Changes

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or for bug fixes
   git checkout -b fix/bug-description
   ```

2. **Make your changes**
   - Follow existing code style
   - Update documentation if needed
   - Test your changes locally

3. **Update version if needed** (for releases)
   ```bash
   # Update version in package.json
   npm version patch  # for bug fixes
   npm version minor  # for new features
   npm version major  # for breaking changes
   
   # This also updates VERSION file
   ```

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: description of your feature"
   # or
   git commit -m "fix: description of bug fix"
   ```

5. **Push to GitHub**
   ```bash
   git push -u origin feature/your-feature-name
   ```

6. **Open a Pull Request**
   - Go to https://github.com/slmingol/uptime-kuma-sync-n-bak
   - Click "Pull requests" → "New pull request"
   - Select your branch
   - Fill in the PR description
   - Submit for review

### Pull Request Checks

When you open a PR, automated checks will run:
- ✅ JavaScript syntax validation
- ✅ JSON configuration validation
- ✅ Docker image build test
- ✅ Script help command tests

### After Merge

Once your PR is merged to `main`:
1. A container image is automatically built
2. Published to GitHub Container Registry (ghcr.io)
3. Tagged with version from package.json
4. Tagged as `latest`

### Version Numbering

We use [Semantic Versioning](https://semver.org/):
- **MAJOR** version for incompatible API changes
- **MINOR** version for new functionality (backwards compatible)
- **PATCH** version for bug fixes (backwards compatible)

### Testing Locally

```bash
# Install dependencies
npm install

# Test scripts
node uptime-kuma-backup.js --help
node uptime-kuma-sync.js --help
node uptime-kuma-restore.js --help

# Test Docker build
docker build -t uptime-kuma-sync:test .
docker run --rm uptime-kuma-sync:test node uptime-kuma-sync.js --help
```

### Docker Image Naming

Images are published with multiple tags:
- `ghcr.io/slmingol/uptime-kuma-sync-n-bak:latest` - Latest main branch
- `ghcr.io/slmingol/uptime-kuma-sync-n-bak:1.0.0` - Specific version
- `ghcr.io/slmingol/uptime-kuma-sync-n-bak:1.0` - Major.minor version
- `ghcr.io/slmingol/uptime-kuma-sync-n-bak:1` - Major version

### Questions?

Open an issue for discussion before starting major work.

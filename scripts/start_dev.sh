#!/bin/bash

# Development startup script for WebAuthn Axum server

set -e

# Change to project root directory
cd "$(dirname "$0")/.."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}WebAuthn Axum Development Setup${NC}"
echo "=================================="

# Check for configuration file
if [ ! -f "assets/config/config.jsonc" ]; then
    echo -e "${YELLOW}Configuration file not found. Creating default config...${NC}"
    cargo run --bin cli config init --with-secrets
    echo ""
    echo -e "${BLUE}📝 Please review and edit assets/config/config.jsonc for your setup${NC}"
    echo -e "${BLUE}💡 Key settings to check:${NC}"
    echo -e "${BLUE}  • Database connection (host, port, username, database)${NC}"
    echo -e "${BLUE}  • WebAuthn settings (rp_ids, rp_origins)${NC}"
    echo -e "${BLUE}  • Server port and host${NC}"
    echo ""
fi

# Check for secrets file
if [ ! -f "assets/config/config.secrets.jsonc" ]; then
    echo -e "${YELLOW}Secrets file not found. Creating default secrets...${NC}"
    cargo run --bin cli config init-secrets
    echo ""
    echo -e "${BLUE}🔐 Please edit assets/config/config.secrets.jsonc with your actual secrets${NC}"
    echo -e "${BLUE}⚠️  Security reminders:${NC}"
    echo -e "${BLUE}  • Change all default passwords${NC}"
    echo -e "${BLUE}  • Use strong, unique credentials${NC}"
    echo -e "${BLUE}  • Set proper file permissions: chmod 600 assets/config/config.secrets.jsonc${NC}"
    echo ""
fi

# Validate configuration
echo -e "${YELLOW}Validating configuration...${NC}"
if ! cargo run --bin cli config validate; then
    echo -e "${RED}Configuration validation failed. Please fix the issues above.${NC}"
    exit 1
fi

# Generate or update .env file for Docker/SQLx compatibility
echo -e "${YELLOW}Generating .env file for Docker/SQLx...${NC}"
cargo run --bin cli config generate-env --with-examples

# Source the generated .env file
if [ -f ".env" ]; then
    export $(cat .env | grep -v '^#' | grep -v '^$' | xargs)
fi

# Check if we have secrets or need environment variables
if [ -f "assets/config/config.secrets.jsonc" ]; then
    echo -e "${GREEN}Found secrets file: assets/config/config.secrets.jsonc${NC}"
    echo -e "${BLUE}💡 Database password will be loaded from secrets file${NC}"
else
    # Check if DATABASE_PASSWORD is set
    if [ -z "$DATABASE_PASSWORD" ] && [ -z "$POSTGRES_PASSWORD" ]; then
        echo -e "${YELLOW}No secrets file found and database password not set in environment.${NC}"
        echo -e "${YELLOW}Please either:${NC}"
        echo "  1. Create secrets file: cargo run --bin cli config init-secrets"
        echo "  2. Set environment variable: export DATABASE_PASSWORD='your_password_here'"
        echo ""
    fi
fi

echo -e "${GREEN}Configuration loaded successfully!${NC}"
echo ""

# Check if PostgreSQL is running
echo -e "${YELLOW}Testing database connection...${NC}"
if ! cargo run --bin cli users stats > /dev/null 2>&1; then
    echo -e "${RED}Cannot connect to database. Please ensure:${NC}"
    echo "1. PostgreSQL is running"
    echo "2. Database exists and is accessible"
    echo "3. Database user has proper permissions"
    echo "4. Database password is set in environment"
    echo "5. Configuration file has correct database settings"
    echo ""
    echo -e "${BLUE}💡 Tips:${NC}"
    echo "  • Check assets/config/config.jsonc database section"
    echo "  • Set DATABASE_PASSWORD environment variable"
    echo "  • Verify PostgreSQL is running: brew services start postgresql@15"
    echo "  • Test connection: psql -h localhost -U postgres -d webauthn_db"
    exit 1
fi

echo -e "${GREEN}Database connection successful!${NC}"
echo ""

# Generate some invite codes if none exist
echo -e "${YELLOW}Checking for existing invite codes...${NC}"
invite_count=$(cargo run --bin cli users stats 2>/dev/null | grep "Active codes:" | awk '{print $3}' || echo "0")

if [ "$invite_count" = "0" ]; then
    echo -e "${YELLOW}No active invite codes found. Generating invite codes...${NC}"
    cargo run --bin cli users generate-invite
    echo ""
    echo -e "${GREEN}Generated invite codes. Use 'cargo run --bin cli users list-invites' to see them.${NC}"
    echo ""
else
    echo -e "${GREEN}Found $invite_count active invite codes.${NC}"
    echo ""
fi

# Show available invite codes
echo -e "${YELLOW}Available invite codes:${NC}"
cargo run --bin cli users list-invites --active-only
echo ""

# Show configuration summary
echo -e "${BLUE}📋 Configuration Summary:${NC}"
cargo run --bin cli config show
echo ""

# Generate JSON Schema for editor support
echo -e "${YELLOW}Generating JSON Schema for editor support...${NC}"
cargo run --bin cli config schema
echo ""

echo -e "${GREEN}🚀 Starting WebAuthn server...${NC}"
echo -e "${YELLOW}📡 Server will be available based on your assets/config/config.jsonc settings${NC}"
echo -e "${YELLOW}🔗 Default: http://localhost:8080${NC}"
echo -e "${YELLOW}⏹️  Press Ctrl+C to stop the server${NC}"
echo ""
echo -e "${BLUE}💡 Useful commands while developing:${NC}"
echo -e "${BLUE}  • View config: cargo run --bin cli config show${NC}"
echo -e "${BLUE}  • Validate config: cargo run --bin cli config validate${NC}"
echo -e "${BLUE}  • List invite codes: cargo run --bin cli users list-invites${NC}"
echo -e "${BLUE}  • Generate codes: cargo run --bin cli users generate-invite${NC}"
echo -e "${BLUE}  • View analytics: cargo run --bin cli analytics analytics${NC}"
echo -e "${BLUE}  • Manage secrets: cargo run --bin cli config init-secrets${NC}"
echo ""

# Start the server
cargo run --bin server

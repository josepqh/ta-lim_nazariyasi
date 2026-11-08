-- ============================================================================
-- TA'LIM NAZARIYASI (NEUROPEDAGOGIKA) - PRODUCTION DATABASE SCHEMA
-- PostgreSQL / Neon Database Serverless Edition
-- Arxitektura: RBAC (Role-Based Access Control), Data Integrity, High-Load Indexing
-- ============================================================================

-- Extensions (UUID generator agar kerak bo'lsa)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. FOYDALANUVCHILAR (USERS JADVALI)
-- ============================================================================
CREATE TABLE IF NOT EXISTS np_users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  login VARCHAR(50) UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role VARCHAR(20) DEFAULT 'student',
  status VARCHAR(20) DEFAULT 'active',               -- active, suspended, blocked, pending
  failed_login_count INTEGER DEFAULT 0,              -- Brute-force himoyasi
  lockout_until TIMESTAMPTZ,                         -- Vaqtinchalik bloklash
  last_login_at TIMESTAMPTZ,                         -- Oxirgi kirish vaqti
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ                             -- Soft delete
);

-- Mavjud jadvallar uchun ustunlarni xavfsiz qo'shish (Migration compatibility)
ALTER TABLE np_users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
ALTER TABLE np_users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER DEFAULT 0;
ALTER TABLE np_users ADD COLUMN IF NOT EXISTS lockout_until TIMESTAMPTZ;
ALTER TABLE np_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE np_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE np_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE np_users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- User Indekslari
CREATE INDEX IF NOT EXISTS idx_np_users_login ON np_users(login);
CREATE INDEX IF NOT EXISTS idx_np_users_role ON np_users(role);
CREATE INDEX IF NOT EXISTS idx_np_users_status_deleted ON np_users(status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_np_users_created_at ON np_users(created_at DESC);


-- ============================================================================
-- 2. MODULLAR (MODULES JADVALI)
-- ============================================================================
CREATE TABLE IF NOT EXISTS np_modules (
  id SERIAL PRIMARY KEY,
  order_num INTEGER UNIQUE NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  created_by INTEGER REFERENCES np_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE np_modules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE np_modules ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Module Indekslari
CREATE INDEX IF NOT EXISTS idx_np_modules_order ON np_modules(order_num);
CREATE INDEX IF NOT EXISTS idx_np_modules_created_by ON np_modules(created_by);
CREATE INDEX IF NOT EXISTS idx_np_modules_deleted_at ON np_modules(deleted_at);


-- ============================================================================
-- 3. MODUL BOSQICHLARI MATERIALLARI (MODULE CONTENT)
-- ============================================================================
CREATE TABLE IF NOT EXISTS np_module_content (
  id SERIAL PRIMARY KEY,
  module_id INTEGER REFERENCES np_modules(id) ON DELETE CASCADE,
  step_type VARCHAR(50) NOT NULL,                    -- diag, video, pres, doc, task, refl
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by INTEGER REFERENCES np_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(module_id, step_type)
);

-- Module Content Indekslari
CREATE INDEX IF NOT EXISTS idx_np_module_content_mod ON np_module_content(module_id);
CREATE INDEX IF NOT EXISTS idx_np_module_content_step ON np_module_content(step_type);
CREATE INDEX IF NOT EXISTS idx_np_module_content_updated_by ON np_module_content(updated_by);


-- ============================================================================
-- 4. TALABALAR PROGRESSI VA MONITORINGI (PROGRESS)
-- ============================================================================
CREATE TABLE IF NOT EXISTS np_progress (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES np_users(id) ON DELETE CASCADE,
  module_id INTEGER REFERENCES np_modules(id) ON DELETE CASCADE,
  completed_steps JSONB DEFAULT '[]'::jsonb,
  step_responses JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(user_id, module_id)
);

ALTER TABLE np_progress ADD COLUMN IF NOT EXISTS step_responses JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE np_progress ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE np_progress ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Progress Yuqori Tezlik Indekslari (Teacher Dashboard va Talaba Natijalari)
CREATE INDEX IF NOT EXISTS idx_np_progress_user_id ON np_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_np_progress_module_id ON np_progress(module_id);
CREATE INDEX IF NOT EXISTS idx_np_progress_user_mod ON np_progress(user_id, module_id);
CREATE INDEX IF NOT EXISTS idx_np_progress_mod_updated ON np_progress(module_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_np_progress_score ON np_progress(total_score DESC);


-- ============================================================================
-- 5. ENTERPRISE RBAC (ROLLAR VA RUXSATLAR MODELI)
-- ============================================================================

-- Rollar jadvali
CREATE TABLE IF NOT EXISTS np_roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,                  -- 'admin', 'teacher', 'student'
  system_type VARCHAR(20) NOT NULL,                  -- 'ADMIN', 'MANAGER', 'CLIENT'
  description VARCHAR(255),
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_np_roles_system_type ON np_roles(system_type);

-- Tizim ruxsatlari (Permissions)
CREATE TABLE IF NOT EXISTS np_permissions (
  id SERIAL PRIMARY KEY,
  action VARCHAR(50) NOT NULL,                       -- 'create', 'read', 'update', 'delete', 'review'
  resource VARCHAR(50) NOT NULL,                     -- 'modules', 'progress', 'users', 'analytics'
  slug VARCHAR(100) UNIQUE NOT NULL,                 -- 'modules:update', 'progress:review'
  description VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(action, resource)
);
CREATE INDEX IF NOT EXISTS idx_np_permissions_resource ON np_permissions(resource);

-- Many-to-Many: Userlar va Rollar
CREATE TABLE IF NOT EXISTS np_user_roles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES np_users(id) ON DELETE CASCADE,
  role_id INTEGER REFERENCES np_roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by INTEGER REFERENCES np_users(id) ON DELETE SET NULL,
  UNIQUE(user_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_np_user_roles_role_id ON np_user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_np_user_roles_user_id ON np_user_roles(user_id);

-- Many-to-Many: Rollar va Ruxsatlar
CREATE TABLE IF NOT EXISTS np_role_permissions (
  id SERIAL PRIMARY KEY,
  role_id INTEGER REFERENCES np_roles(id) ON DELETE CASCADE,
  permission_id INTEGER REFERENCES np_permissions(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(role_id, permission_id)
);
CREATE INDEX IF NOT EXISTS idx_np_role_permissions_role ON np_role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_np_role_permissions_perm ON np_role_permissions(permission_id);


-- ============================================================================
-- 6. AUDIT LOGS (XAVFSIZLIK VA HARAKATLAR TARIXI)
-- ============================================================================
CREATE TABLE IF NOT EXISTS np_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES np_users(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL,                       -- LOGIN, LOGOUT, CREATE_MODULE, REVIEW_TASK
  entity_name VARCHAR(100) NOT NULL,                 -- 'np_modules', 'np_progress', 'np_users'
  entity_id VARCHAR(64),
  old_values JSONB,
  new_values JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit Indekslari (Tezkor qidiruv va tahlil)
CREATE INDEX IF NOT EXISTS idx_np_audit_entity ON np_audit_logs(entity_name, entity_id);
CREATE INDEX IF NOT EXISTS idx_np_audit_actor ON np_audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_np_audit_action_created ON np_audit_logs(action, created_at DESC);


-- ============================================================================
-- 7. SESSIYALAR VA XAVFSIZLIK TOKENLARI (SESSION MANAGEMENT)
-- ============================================================================
CREATE TABLE IF NOT EXISTS np_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES np_users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) UNIQUE NOT NULL,           -- SHA-256 heshlangan token
  user_agent TEXT,
  ip_address VARCHAR(45),
  device_type VARCHAR(50),
  is_valid BOOLEAN DEFAULT true,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW()
);

-- Faol sessiyalarni zudlik bilan tekshirish indeksi
CREATE INDEX IF NOT EXISTS idx_np_sessions_active ON np_sessions(user_id, is_valid, expires_at);
CREATE INDEX IF NOT EXISTS idx_np_sessions_token ON np_sessions(token_hash);


-- ============================================================================
-- 8. BILDIRISHNOMALAR (NOTIFICATIONS)
-- ============================================================================
CREATE TABLE IF NOT EXISTS np_notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES np_users(id) ON DELETE CASCADE,
  type VARCHAR(50) DEFAULT 'SYSTEM_ALERT',
  priority VARCHAR(20) DEFAULT 'MEDIUM',
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}'::jsonb,
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- O'qilmagan xabarlarni filtrlash indeksi
CREATE INDEX IF NOT EXISTS idx_np_notif_user_unread ON np_notifications(user_id, is_read, deleted_at, created_at DESC);


-- ============================================================================
-- 9. YUKLANGAN FAYLLAR (Serverless so'rov chegarasi uchun bo'laklab saqlanadi)
-- ============================================================================
CREATE TABLE IF NOT EXISTS np_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id INTEGER REFERENCES np_users(id) ON DELETE SET NULL,
  module_id INTEGER NOT NULL REFERENCES np_modules(id) ON DELETE CASCADE,
  step_type TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('content', 'submission')),
  filename TEXT NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 200),
  extension TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  total_chunks INTEGER NOT NULL CHECK (total_chunks > 0),
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'ready')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_np_files_owner_status ON np_files(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_np_files_module_step ON np_files(module_id, step_type, purpose);

CREATE TABLE IF NOT EXISTS np_file_chunks (
  file_id UUID NOT NULL REFERENCES np_files(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  data BYTEA NOT NULL,
  PRIMARY KEY (file_id, chunk_index)
);

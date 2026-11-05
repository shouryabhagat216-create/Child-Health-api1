# The values below are generated here, so they exist in the Terraform state: keep the state private (it is
# git-ignored) and never share it. The ABDM client id and secret are NOT set here: Terraform creates a placeholder
# and ignores later changes, so you set the real values yourself in Secrets Manager (console or CLI) and they
# never pass through Terraform, chat or git.

resource "random_password" "jwt" {
  length  = 48
  special = false
}

resource "random_id" "state_key" {
  byte_length = 32
}

resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${var.name}/database-url"
  recovery_window_in_days = var.db_protected ? 7 : 0 # demo: delete at once on destroy
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  # uselibpqcompat: encrypt the connection but do not verify the RDS certificate chain (node-postgres does not
  # carry the RDS CA bundle). rds.force_ssl is on by default for PostgreSQL 16.
  secret_string = "postgres://${aws_db_instance.main.username}:${random_password.db.result}@${aws_db_instance.main.address}:5432/${aws_db_instance.main.db_name}?sslmode=require&uselibpqcompat=true"
}

resource "aws_secretsmanager_secret" "jwt" {
  name                    = "${var.name}/jwt-secret"
  recovery_window_in_days = var.db_protected ? 7 : 0
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id     = aws_secretsmanager_secret.jwt.id
  secret_string = random_password.jwt.result
}

resource "aws_secretsmanager_secret" "state_key" {
  name                    = "${var.name}/state-encryption-key"
  recovery_window_in_days = var.db_protected ? 7 : 0
}

resource "aws_secretsmanager_secret_version" "state_key" {
  secret_id     = aws_secretsmanager_secret.state_key.id
  secret_string = random_id.state_key.b64_std
}

resource "aws_secretsmanager_secret" "abdm_client_id" {
  name                    = "${var.name}/abdm-client-id"
  recovery_window_in_days = var.db_protected ? 7 : 0
}

resource "aws_secretsmanager_secret_version" "abdm_client_id" {
  secret_id     = aws_secretsmanager_secret.abdm_client_id.id
  secret_string = "SET-ME-IN-SECRETS-MANAGER"
  lifecycle { ignore_changes = [secret_string] }
}

resource "aws_secretsmanager_secret" "abdm_client_secret" {
  name                    = "${var.name}/abdm-client-secret"
  recovery_window_in_days = var.db_protected ? 7 : 0
}

resource "aws_secretsmanager_secret_version" "abdm_client_secret" {
  secret_id     = aws_secretsmanager_secret.abdm_client_secret.id
  secret_string = "SET-ME-IN-SECRETS-MANAGER"
  lifecycle { ignore_changes = [secret_string] }
}

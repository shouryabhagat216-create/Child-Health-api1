resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = var.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "main" {
  identifier     = var.name
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage = var.db_allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = "childhealth"
  username = "childhealth"
  password = random_password.db.result
  port     = 5432

  multi_az               = var.db_multi_az
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false

  backup_retention_period    = var.db_protected ? 7 : 1
  auto_minor_version_upgrade = true

  # Demo (db_protected = false): one `terraform destroy` removes everything. Real environment: the database
  # cannot be deleted until protection is switched off, and a final snapshot is kept.
  deletion_protection       = var.db_protected
  skip_final_snapshot       = !var.db_protected
  final_snapshot_identifier = var.db_protected ? "${var.name}-final" : null
}

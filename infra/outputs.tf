output "url" {
  value = "https://${local.public_host}"
}

output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "abdm_public_base_url" {
  description = "Value for ABDM_PUBLIC_BASE_URL when running backend/scripts/bridge-url-v3.js --apply"
  value       = "https://${aws_cloudfront_distribution.main.domain_name}"
}

output "abdm_secret_names" {
  description = "Set the real values of these two yourself in Secrets Manager"
  value       = [aws_secretsmanager_secret.abdm_client_id.name, aws_secretsmanager_secret.abdm_client_secret.name]
}

output "log_group" {
  value = aws_cloudwatch_log_group.api.name
}

output "cloudfront_domain" {
  description = "Point the custom hostname (CNAME) at this address in DNS"
  value       = aws_cloudfront_distribution.main.domain_name
}

output "acm_validation_records" {
  description = "Add these CNAME records in DNS so the certificate can be issued"
  value = local.use_domain ? [for o in aws_acm_certificate.site[0].domain_validation_options : {
    name  = o.resource_record_name
    type  = o.resource_record_type
    value = o.resource_record_value
  }] : []
}

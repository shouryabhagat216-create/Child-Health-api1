# Custom hostname for the public address. The domain's DNS is managed outside AWS, so the records are added by hand:
#   stage 1 (domain_name set, domain_attach = false): request a free ACM certificate; add the validation CNAME it outputs.
#   stage 2 (domain_attach = true): wait for it to be issued, attach it to CloudFront and use the name as the app's
#           public address (ABDM_PUBLIC_BASE_URL, CORS_ORIGIN); then add a CNAME from the hostname to cloudfront_domain.
locals {
  use_domain    = var.domain_name != null
  attach_domain = local.use_domain && var.domain_attach
  public_host   = local.attach_domain ? var.domain_name : aws_cloudfront_distribution.main.domain_name
}

resource "aws_acm_certificate" "site" {
  count             = local.use_domain ? 1 : 0
  provider          = aws.us_east_1
  domain_name       = var.domain_name
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_acm_certificate_validation" "site" {
  count           = local.attach_domain ? 1 : 0
  provider        = aws.us_east_1
  certificate_arn = aws_acm_certificate.site[0].arn
}

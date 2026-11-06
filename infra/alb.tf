# Public HTTPS comes from CloudFront's own address (*.cloudfront.net), so there is no domain, ACM certificate or
# Route 53 here. CloudFront talks to the load balancer over HTTP, so the load balancer is locked to CloudFront:
#   1. its security group admits only CloudFront's origin-facing address list, and
#   2. its listener forwards only requests carrying a secret header that CloudFront adds (anything else gets 403).
# The header is a shared secret held in the Terraform state; it stops someone who reaches the load balancer's own
# address from skipping CloudFront (and with it the address allow-list below).

resource "random_password" "origin_verify" {
  length  = 40
  special = false
}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_lb" "main" {
  name                       = var.name
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.alb.id]
  subnets                    = aws_subnet.public[*].id
  drop_invalid_header_fields = true
}

resource "aws_lb_target_group" "api" {
  name        = var.name
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
  deregistration_delay = 30
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "from_cloudfront" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [random_password.origin_verify.result]
    }
  }
}

# ---- CloudFront ----
# Who may open what is decided here, because there is no WAF:
#   /api/v3/*  (ABDM callbacks and the records push) - anyone; the app checks the bearer token, the facility header
#              and that the callback answers a call we sent.
#   everything else (dashboard, mock login, guardian API) - only viewers whose address is in allowed_cidrs.
data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

resource "aws_cloudfront_function" "viewer_ip" {
  name    = "${var.name}-viewer-ip"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = templatefile("${path.module}/viewer_ip_check.js.tftpl", { allowed = jsonencode(var.allowed_cidrs) })
}

resource "aws_cloudfront_distribution" "main" {
  enabled         = true
  is_ipv6_enabled = false # viewers arrive over IPv4, which is what the address check understands
  comment         = var.name
  price_class     = "PriceClass_100"
  aliases         = local.attach_domain ? [var.domain_name] : []

  origin {
    origin_id   = "alb"
    domain_name = aws_lb.main.dns_name

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }
  }

  default_cache_behavior {
    target_origin_id         = "alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id # pass headers (Authorization) through

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.viewer_ip.arn
    }
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate {
    cloudfront_default_certificate = local.attach_domain ? null : true
    acm_certificate_arn            = local.attach_domain ? aws_acm_certificate_validation.site[0].certificate_arn : null
    ssl_support_method             = local.attach_domain ? "sni-only" : null
    minimum_protocol_version       = local.attach_domain ? "TLSv1.2_2021" : null
  }
}

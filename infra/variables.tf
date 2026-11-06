variable "region" {
  description = "AWS Region for every resource. No default on purpose: set it deliberately (the wombto18 account uses ap-south-1, Mumbai)."
  type        = string
}

variable "aws_profile" {
  description = "AWS CLI profile for Terraform's own credentials, or null to use AWS_* environment variables. The aws login session is not read by the provider directly: export it first (see README)."
  type        = string
  default     = null
}

variable "name" {
  description = "Prefix for every resource name."
  type        = string
  default     = "wombto18-demo"
}

variable "allowed_cidrs" {
  description = "IPv4 addresses (for example [\"203.0.113.7/32\"]) allowed to open the dashboard and the mock login. ABDM callbacks under /api/v3/ stay reachable from anywhere (they are checked by the app)."
  type        = list(string)

  validation {
    condition     = length(var.allowed_cidrs) > 0 && alltrue([for c in var.allowed_cidrs : can(regex("^[0-9]{1,3}(\\.[0-9]{1,3}){3}/(8|9|[12][0-9]|3[0-2])$", c))])
    error_message = "List at least one IPv4 address as a CIDR with a prefix of /8 to /32 (use /32 for one address). 0.0.0.0/0 is refused: the mock login must not be open to the internet."
  }
}

variable "desired_count" {
  description = "Number of API tasks. Keep 0 for the first apply (the image is not pushed yet), then 1. Do not go above 1 until rate limiting moves to a shared store."
  type        = number
  default     = 0

  validation {
    condition     = var.desired_count >= 0 && var.desired_count <= 1
    error_message = "This demo is built for at most one task."
  }
}

variable "image_tag" {
  description = "Tag of the image in ECR to run."
  type        = string
  default     = "latest"
}

variable "task_cpu" {
  type    = number
  default = 256
}

variable "task_memory" {
  type    = number
  default = 512
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "environment" {
  description = "Value of the Environment tag."
  type        = string
  default     = "staging-demo"
}

variable "db_multi_az" {
  description = "Standby database in a second Availability Zone (roughly doubles the database cost)."
  type        = bool
  default     = false
}

variable "db_protected" {
  description = "true for a real environment: deletion protection on, a final snapshot is taken on destroy, 7 days of backups. false keeps the demo's one-command teardown."
  type        = bool
  default     = false
}

variable "domain_name" {
  description = "Custom hostname for the public address (for example health-api.wombto18.org). null keeps the *.cloudfront.net address. Setting it requests a certificate (stage 1); the DNS records are added by hand wherever the domain's DNS is managed."
  type        = string
  default     = null
}

variable "domain_attach" {
  description = "Stage 2: attach domain_name to CloudFront. Set true only after the certificate's validation record is in DNS, otherwise apply waits for validation."
  type        = bool
  default     = false
}

variable "alarm_email" {
  description = "Address that receives CloudWatch alarm emails. null creates no alarms. AWS sends a confirmation link to it that must be clicked once."
  type        = string
  default     = null
}

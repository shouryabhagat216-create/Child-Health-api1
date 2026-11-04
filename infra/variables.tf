variable "region" {
  description = "The project's single AWS Region (AWS Settings > View all projects > Overview > Additional info > Region). No default on purpose: confirm it first."
  type        = string
}

variable "aws_profile" {
  description = "AWS CLI profile to use (sign in with: aws login --region <region> --profile demo)."
  type        = string
  default     = "demo"
}

variable "name" {
  description = "Prefix for every resource name."
  type        = string
  default     = "wombto18-demo"
}

variable "domain_name" {
  description = "Public host name for the demo, for example demo.example.org. Must be inside the Route 53 hosted zone below."
  type        = string
}

variable "route53_zone_id" {
  description = "Id of the Route 53 hosted zone that holds domain_name (used for the ACM certificate validation and the alias record)."
  type        = string
}

variable "allowed_cidrs" {
  description = "Addresses (for example [\"203.0.113.7/32\"]) allowed to open the dashboard and the mock login. ABDM callbacks under /api/v3/ stay reachable from anywhere (they are checked by the app)."
  type        = list(string)

  validation {
    condition     = length(var.allowed_cidrs) > 0 && !contains(var.allowed_cidrs, "0.0.0.0/0")
    error_message = "List at least one address and do not use 0.0.0.0/0: the mock login must not be open to the internet."
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

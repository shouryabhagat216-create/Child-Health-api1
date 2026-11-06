# Alarms that email alarm_email: the API is down or unhealthy, the API returns errors, the database is struggling.
# Metrics are free to publish; each alarm costs about 0.10 USD a month. No alarms are created while alarm_email is null.
locals {
  alarms_on = var.alarm_email != null
  alb_dims = {
    LoadBalancer = aws_lb.main.arn_suffix
    TargetGroup  = aws_lb_target_group.api.arn_suffix
  }
}

resource "aws_sns_topic" "alarms" {
  count = local.alarms_on ? 1 : 0
  name  = "${var.name}-alarms"
}

resource "aws_sns_topic_subscription" "alarm_email" {
  count     = local.alarms_on ? 1 : 0
  topic_arn = aws_sns_topic.alarms[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_metric_alarm" "api_unhealthy" {
  count               = local.alarms_on ? 1 : 0
  alarm_name          = "${var.name}-api-no-healthy-task"
  alarm_description   = "No healthy API task behind the load balancer (the app is down)."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  dimensions          = local.alb_dims
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alarms[0].arn]
  ok_actions          = [aws_sns_topic.alarms[0].arn]
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  count               = local.alarms_on ? 1 : 0
  alarm_name          = "${var.name}-api-5xx"
  alarm_description   = "The API returned 5 or more server errors in 5 minutes, twice in a row."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions          = { LoadBalancer = aws_lb.main.arn_suffix }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms[0].arn]
  ok_actions          = [aws_sns_topic.alarms[0].arn]
}

resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  count               = local.alarms_on ? 1 : 0
  alarm_name          = "${var.name}-db-cpu-high"
  alarm_description   = "Database CPU above 80% for 15 minutes."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms[0].arn]
  ok_actions          = [aws_sns_topic.alarms[0].arn]
}

resource "aws_cloudwatch_metric_alarm" "db_storage" {
  count               = local.alarms_on ? 1 : 0
  alarm_name          = "${var.name}-db-storage-low"
  alarm_description   = "Less than 3 GiB of database storage free."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 3 * 1024 * 1024 * 1024
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms[0].arn]
  ok_actions          = [aws_sns_topic.alarms[0].arn]
}

resource "aws_cloudwatch_metric_alarm" "db_memory" {
  count               = local.alarms_on ? 1 : 0
  alarm_name          = "${var.name}-db-memory-low"
  alarm_description   = "Less than 100 MiB of database memory free for 15 minutes."
  namespace           = "AWS/RDS"
  metric_name         = "FreeableMemory"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 100 * 1024 * 1024
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms[0].arn]
  ok_actions          = [aws_sns_topic.alarms[0].arn]
}

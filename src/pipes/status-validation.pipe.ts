import { BadRequestException, PipeTransform } from '@nestjs/common';

const allowedStatuses = ['Pending', 'Complete', 'Overdue'] as const;
type AllowedStatus = typeof allowedStatuses[number];

export class StatusValidationPipe implements PipeTransform {
  transform(value: any) {
    if (!this.isStatusValid(value)) {
      throw new BadRequestException(`"${value}" is an invalid status. Status must be one of: ${allowedStatuses.join(', ')}`);
    }
    return value;
  }

  private isStatusValid(status: any): status is AllowedStatus {
    return allowedStatuses.includes(status);
  }
}
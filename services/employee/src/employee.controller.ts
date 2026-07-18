import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards
} from '@nestjs/common';
import { JwtAuthGuard, Roles, RolesGuard } from '@atlas/platform';
import { EmployeeService } from './employee.service';
import { ChangeManagerDto, CreateEmployeeDto, UpdateEmployeeDto } from './dto';

@Controller('employees')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmployeeController {
  constructor(private readonly employees: EmployeeService) {}

  @Get()
  list() {
    return this.employees.listAll();
  }

  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.employees.getById(id);
  }

  @Get(':id/reports')
  getReports(@Param('id', ParseUUIDPipe) id: string) {
    return this.employees.getDirectReports(id);
  }

  @Get(':id/org-chart')
  getOrgChart(@Param('id', ParseUUIDPipe) id: string) {
    return this.employees.getOrgChart(id);
  }

  @Post()
  @Roles('Admin', 'Manager')
  create(@Body() body: CreateEmployeeDto) {
    return this.employees.create({
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      title: body.title,
      department: body.department,
      managerId: body.managerId,
      status: body.status
    });
  }

  @Put(':id')
  @Roles('Admin', 'Manager')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateEmployeeDto) {
    return this.employees.update(id, {
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      title: body.title,
      department: body.department,
      status: body.status
    });
  }

  @Put(':id/manager')
  @Roles('Admin')
  changeManager(@Param('id', ParseUUIDPipe) id: string, @Body() body: ChangeManagerDto) {
    return this.employees.changeManager(id, body.managerId ?? null);
  }
}

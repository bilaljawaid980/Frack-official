import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateTokenBuyIntentDto } from './dto/create-token-buy-intent.dto';
import { CreateTokenSellListingDto } from './dto/create-token-sell-listing.dto';
import { UpdateTokenBuyIntentDto } from './dto/update-token-buy-intent.dto';
import { UpdateTokenSellListingDto } from './dto/update-token-sell-listing.dto';
import { TokenListingsService } from './token-listings.service';

@Controller('token-listings')
export class TokenListingsController {
  constructor(private readonly service: TokenListingsService) {}

  @Post()
  createListing(@Body() dto: CreateTokenSellListingDto) {
    return this.service.createListing(dto);
  }

  @Get()
  findListings(@Query() query: Record<string, string>) {
    return this.service.findListings(query);
  }

  @Get('buy-intents')
  findBuyIntents(@Query() query: Record<string, string>) {
    return this.service.findBuyIntents(query);
  }

  @Get('buy-intents/:id')
  findBuyIntent(@Param('id') id: string) {
    return this.service.findBuyIntent(id);
  }

  @Patch('buy-intents/:id/status')
  updateBuyIntentStatus(@Param('id') id: string, @Body() dto: UpdateTokenBuyIntentDto) {
    return this.service.updateBuyIntentStatus(id, dto);
  }

  @Patch('buy-intents/:id/resume-after-identity')
  resumeBuyIntentAfterIdentity(@Param('id') id: string) {
    return this.service.resumeBuyIntentAfterIdentity(id);
  }

  @Get(':id')
  findListing(@Param('id') id: string) {
    return this.service.findListing(id);
  }

  @Patch(':id/status')
  updateListingStatus(@Param('id') id: string, @Body() dto: UpdateTokenSellListingDto) {
    return this.service.updateListingStatus(id, dto);
  }

  @Post(':id/buy-intents')
  createBuyIntent(@Param('id') id: string, @Body() dto: CreateTokenBuyIntentDto) {
    return this.service.createBuyIntent(id, dto);
  }
}
